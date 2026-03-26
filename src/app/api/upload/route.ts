import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Ensures we parse all incoming data. Larger CSVs might need streaming instead.
export const maxDuration = 60; // Max duration for Vercel

export async function POST(req: Request) {
    try {
        const { tableName, columns, rows } = await req.json();

        if (!tableName || !columns || !rows) {
            return NextResponse.json({ error: 'Missing tableName, columns, or rows' }, { status: 400 });
        }

        // 1. Construct SQL to dynamically create the table in Supabase (PostgreSQL)
        // Convert PapaParse types to Postgres types
        const columnDefinitions = columns.map((col: any) => {
            let pgType = 'TEXT';
            if (col.type === 'number') pgType = 'DOUBLE PRECISION';
            if (col.type === 'boolean') pgType = 'BOOLEAN';
            return `"${col.name}" ${pgType}`;
        }).join(', ');

        // We add an id automatically
        const createTableSql = `CREATE TABLE IF NOT EXISTS "${tableName}" (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ${columnDefinitions}
    );
    NOTIFY pgrst, 'reload schema';`;

        console.log("Creating table:", createTableSql);

        // To execute raw DDL in Supabase via REST, we assume the user created the 'exec_sql' RPC
        const { error: ddlError } = await supabaseAdmin.rpc('exec_sql', { query: createTableSql });

        // DDL error might happen if the executing script tries to return rows from a CREATE TABLE.
        if (ddlError) {
            console.error("DDL Exec Error (might be benign if it succeeded anyway):", ddlError.message);
        }

        // 2. Insert data dynamically using chunked batches with schema cache resilience
        const CHUNK_SIZE = 500;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            let finalError = null;

            // PostgREST caching can lag table creation. Give it time to index natively via smart retries
            for (let retry = 0; retry < 5; retry++) {
                const { error: insertError } = await supabaseAdmin.from(tableName).insert(chunk);
                finalError = insertError;

                if (!insertError) break; // Success!

                // If it's the schema desync bug, back off aggressively then retry
                if (insertError.message.includes('schema cache')) {
                    console.warn(`[Chunk ${i}] Schema cache miss syncing ${tableName}. Retrying in 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    break; // A hard fail (e.g., bad format), don't retry
                }
            }

            if (finalError) {
                throw new Error(`Failed to insert rows at chunk ${i} after 5 retries: ${finalError.message}`);
            }
        }

        return NextResponse.json({ success: true, tableName });
    } catch (err: any) {
        console.error("Upload API Error:", err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

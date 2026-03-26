import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;

export async function POST(req: Request) {
    try {
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 400 });

        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });

        // Read PDF as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // pdf-parse uses CJS exports; import via require to avoid ESM default issues
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(buffer);
        const rawText = pdfData.text.trim();

        if (!rawText || rawText.length < 50) {
            return NextResponse.json({ error: 'Could not extract text from this PDF. It may be image-based.' }, { status: 422 });
        }

        // Limit text to 8000 chars to keep Groq prompt manageable
        const truncatedText = rawText.slice(0, 8000);

        // Use Groq to intelligently extract structured data from the PDF text
        const groq = new Groq({ apiKey: groqApiKey });
        const result = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'Output raw JSON only. No markdown, no explanation.' },
                {
                    role: 'user', content: `You are an expert data extraction system.
PDF file: "${file.name}"
Extracted text:
${truncatedText}

Tasks:
1. Find the primary dataset, table, or structured data in this PDF.
2. Convert it to a clean JSON array of row objects.
3. Use clean underscore_case column names.
4. Suggest a short dataset name (e.g., "quarterly_revenue_report").

Return exactly this JSON:
{
  "datasetName": "dataset_name",
  "columns": [{"name": "col_name", "type": "string|number|boolean"}],
  "rows": [{"col_name": value, ...}]
}

If no structured data found, return: {"error": "No structured tabular data found in this PDF"}`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
        });

        const content = result.choices[0]?.message?.content?.trim() || '{}';
        const parsed = JSON.parse(content);

        if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 422 });

        return NextResponse.json({
            datasetName: parsed.datasetName || 'pdf_data',
            columns: parsed.columns || [],
            rows: parsed.rows || []
        });

    } catch (err: any) {
        console.error('PDF Ingest Error:', err);
        return NextResponse.json({ error: err.message || 'Failed to process PDF' }, { status: 500 });
    }
}

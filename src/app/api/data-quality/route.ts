import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;

export async function POST(req: Request) {
    try {
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 400 });

        const { columns, sampleRows } = await req.json();
        if (!columns || !sampleRows) return NextResponse.json({ error: 'Missing columns or sampleRows' }, { status: 400 });

        const groq = new Groq({ apiKey: groqApiKey });

        const result = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'Output raw JSON only.' },
                {
                    role: 'user', content: `You are a data quality expert.
Analyze this dataset schema and sample rows for quality issues.

Columns: ${JSON.stringify(columns)}
Sample Rows (first 3): ${JSON.stringify(sampleRows, null, 2)}

Return ONLY this JSON:
{
  "score": 85,
  "issues": [
    {"column": "column_name", "severity": "warning|error", "issue": "description", "suggestion": "how to fix"}
  ],
  "summary": "One sentence overall quality assessment",
  "insights": ["interesting observation 1", "interesting observation 2", "interesting observation 3"]
}

Check for:
- Columns that might have missing/null values based on naming (optional vs required fields)
- Mixed data types (e.g., numeric column stored as string)
- Potential date columns detected as strings
- Columns with very generic names that might need clarification
- Currency/percentage columns that might need parsing
- Potential duplicate key columns
- Score out of 100 based on overall schema quality`
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            max_tokens: 800,
            response_format: { type: 'json_object' }
        });

        const content = result.choices[0]?.message?.content?.trim() || '{}';
        return NextResponse.json(JSON.parse(content));

    } catch (err: any) {
        console.error('Data Quality Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

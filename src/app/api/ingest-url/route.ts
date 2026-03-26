import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;

// HELPER: Model fallback for rate limits
async function getGroqCompletion(groq: Groq, options: any) {
    const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
    let lastError: any = null;
    for (const model of models) {
        try { return await groq.chat.completions.create({ ...options, model }); } 
        catch (err: any) { lastError = err; if (err.status === 429) continue; throw err; }
    }
    throw lastError;
}

export async function POST(req: Request) {
    try {
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 400 });

        const { url } = await req.json();
        if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 });

        let html = '';
        try {
            const puppeteer = await import('puppeteer');
            const browser = await puppeteer.default.launch({ 
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
            await new Promise(r => setTimeout(r, 2000));
            html = await page.content();
            await browser.close();
        } catch (err: any) {
            console.warn('Puppeteer failed, falling back to fetch:', err.message);
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
            html = await res.text();
        }

        const $ = cheerio.load(html);
        const tables: string[] = [];
        $('table').each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            if (text.length > 50) tables.push(text);
        });

        const pageText = $('main, article, body')
            .find('p, li, td, th, h1, h2, h3, span[class*="price"], div[class*="data"]')
            .map((_, el) => $(el).text().trim()).get()
            .filter(t => t.length > 10).join('\n').slice(0, 8000);

        const extractedContent = tables.length > 0
            ? `TABLES:\n${tables.slice(0, 5).join('\n\n')}\n\nCONTENT:\n${pageText}`
            : `CONTENT:\n${pageText}`;

        const groq = new Groq({ apiKey: groqApiKey });
        const parseResult = await getGroqCompletion(groq, {
            messages: [
                { role: 'system', content: 'Output raw JSON only.' },
                {
                    role: 'user', content: `Extract primary dataset from: ${url}\n\n${extractedContent.slice(0, 8000)}\n\nReturn JSON: {"datasetName":"name","columns":[{"name":"col","type":"string|number"}],"rows":[{...}]}`
                }
            ],
            temperature: 0, max_tokens: 4000,
            response_format: { type: 'json_object' }
        });

        const content = parseResult.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);

        if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 422 });

        return NextResponse.json({
            datasetName: parsed.datasetName || 'scraped_dataset',
            columns: parsed.columns || [],
            rows: parsed.rows || []
        });

    } catch (err: any) {
        console.error('Ingest URL Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

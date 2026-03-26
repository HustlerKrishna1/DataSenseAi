import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;

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

        const { query } = await req.json();
        if (!query) return NextResponse.json({ error: 'Search query required' }, { status: 400 });

        const groq = new Groq({ apiKey: groqApiKey });

        // Step 1: DuckDuckGo Lite
        let searchResultUrls: string[] = [];
        try {
            const ddgLiteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            const response = await fetch(ddgLiteUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(6000)
            });
            const searchHtml = await response.text();
            const $ = cheerio.load(searchHtml);
            $('a[href*="uddg="]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const match = href.match(/uddg=([^&]+)/);
                if (match) try { searchResultUrls.push(decodeURIComponent(match[1])); } catch { }
            });
            searchResultUrls = [...new Set(searchResultUrls)].slice(0, 3);
        } catch (err) { console.warn('DDG failed', err); }

        // Step 2: Scrape content - INCREASED BACK TO 8000 CHARACTERS
        let combinedContent = '';
        const limitPerUrl = 3000; // Increased to allow more data per source

        if (searchResultUrls.length > 0) {
            try {
                // Check if we can run Puppeteer (Vercel checks frequently fail here, adding guard)
                let browser: any = null;
                try {
                    const puppeteer = await import('puppeteer');
                    browser = await puppeteer.default.launch({ 
                        headless: true, 
                        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
                    });
                } catch {
                    console.warn('Puppeteer not available, falling back to static fetch for search.');
                }

                if (browser) {
                    for (const url of searchResultUrls) {
                        try {
                            const page = await browser.newPage();
                            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
                            const html = await page.content();
                            const $ = cheerio.load(html);
                            const dataText = $('table, p, td, th').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 15).join(' ').slice(0, limitPerUrl);
                            combinedContent += `\nSOURCE ${url}: ${dataText}\n`;
                            await page.close();
                        } catch { }
                    }
                    await browser.close();
                } else {
                    // Static fetch fallback for Vercel
                    for (const url of searchResultUrls) {
                        try {
                            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                            const html = await res.text();
                            const $ = cheerio.load(html);
                            const dataText = $('table, p, td, th').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 15).join(' ').slice(0, limitPerUrl);
                            combinedContent += `\nSOURCE ${url}: ${dataText}\n`;
                        } catch { }
                    }
                }
            } catch { }
        }

        // TRUNCATE COMBINED CONTENT TO 8000 AS REQUESTED
        const finalContent = combinedContent.trim().slice(0, 8000);

        const prompt = finalContent
            ? `Extract dataset from: \n${finalContent}\n\nQuery: "${query}"`
            : `Generate highly accurate dataset for: "${query}" from your knowledge base.`;

        const result = await getGroqCompletion(groq, {
            messages: [
                { role: 'system', content: 'Output raw JSON only.' },
                {
                    role: 'user', content: `${prompt}\nReturn JSON: {"datasetName":"name","columns":[{"name":"col","type":"string|number"}],"rows":[{...}]}`
                }
            ],
            temperature: 0.1, max_tokens: 4000,
            response_format: { type: 'json_object' }
        });

        const parsed = JSON.parse(result.choices[0]?.message?.content || '{}');
        return NextResponse.json({
            datasetName: parsed.datasetName || 'web_data',
            columns: parsed.columns || [],
            rows: parsed.rows || [],
            sources: searchResultUrls.length > 0 ? searchResultUrls : ['AI Knowledge Base']
        });

    } catch (err: any) {
        console.error('Web Search Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

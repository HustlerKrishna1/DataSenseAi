import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;

// Priority financial sources to scrape (order = credibility)
const FINANCIAL_SOURCES = [
  { name: 'Yahoo Finance', urlFn: (q: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(q)}/analysis/` },
  { name: 'Moneycontrol', urlFn: (q: string) => `https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=${encodeURIComponent(q)}&cid=&mbsearch_str=&topsearch_type=1&search_str=${encodeURIComponent(q)}` },
  { name: 'Screener.in', urlFn: (q: string) => `https://www.screener.in/company/${encodeURIComponent(q.split(' ')[0].toUpperCase())}/` },
  { name: 'ET Markets', urlFn: (q: string) => `https://economictimes.indiatimes.com/markets/stocks/news?query=${encodeURIComponent(q)}` },
  { name: 'TradingView', urlFn: (q: string) => `https://www.tradingview.com/symbols/${encodeURIComponent(q.toUpperCase())}/` },
];

// Generic DDG search for fallback
const DDG_SEARCH = async (query: string): Promise<string[]> => {
  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query + ' site:moneycontrol.com OR site:economictimes.com OR site:screener.in OR site:finance.yahoo.com')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const urls: string[] = [];
    $('a[href*="uddg="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/uddg=([^&]+)/);
      if (match) try { urls.push(decodeURIComponent(match[1])); } catch { }
    });
    return [...new Set(urls)].slice(0, 8);
  } catch { return []; }
};

async function scrapeUrl(url: string, browserAvailable: any): Promise<string> {
  try {
    if (browserAvailable) {
      const page = await browserAvailable.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await new Promise(r => setTimeout(r, 1200));
      const html = await page.content();
      await page.close();
      const $ = cheerio.load(html);
      return $('table, p, td, th, h2, h3, [class*="price"], [class*="target"], [class*="forecast"], [class*="analyst"]')
        .map((_, el) => $(el).text().trim()).get().filter(t => t.length > 8).join(' ').slice(0, 3000);
    } else {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const html = await res.text();
      const $ = cheerio.load(html);
      return $('table, p, td, th, h2, h3').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 8).join(' ').slice(0, 3000);
    }
  } catch { return ''; }
}

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
    const { query, context } = await req.json();
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 });

    const groq = new Groq({ apiKey: groqApiKey });

    // Step 1: Generate targeted search URLs for this specific question
    const urlGenRes = await getGroqCompletion(groq, {
      messages: [
        { role: 'system', content: 'Output raw JSON only.' },
        { role: 'user', content: `Given this financial research question: "${query}"
Extract a search query string (2-5 words, specific to financial data, company name + metric).
Return JSON: {"searchQuery": "...", "companyTicker": "..." or null}` }
      ],
      temperature: 0, max_tokens: 100,
      response_format: { type: 'json_object' }
    });
    const urlGenData = JSON.parse(urlGenRes.choices[0]?.message?.content || '{}');
    const searchQuery = urlGenData.searchQuery || query;

    // Step 2: Get URLs from DDG targeting financial sites
    const searchUrls = await DDG_SEARCH(searchQuery + ' analyst target forecast 2024 2025');
    console.log(`[Research] Found ${searchUrls.length} URLs for: "${searchQuery}"`);

    // Step 3: Scrape with Puppeteer (parallel, max 5 pages)
    let browser: any = null;
    try {
      const puppeteer = await import('puppeteer');
      browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch { console.warn('[Research] Puppeteer unavailable, using static fetch'); }

    const scrapedContents: { url: string; content: string }[] = [];
    const urlsToScrape = searchUrls.slice(0, 6);
    await Promise.allSettled(urlsToScrape.map(async (url) => {
      const content = await scrapeUrl(url, browser);
      if (content.length > 50) scrapedContents.push({ url, content });
    }));
    if (browser) await browser.close();

    console.log(`[Research] Successfully scraped ${scrapedContents.length} sources`);

    // Step 4: Fact-check and synthesize across sources
    const allContent = scrapedContents.map(s => `--- SOURCE: ${s.url} ---\n${s.content}`).join('\n\n');

    const SKILL_RULES = `You are an intelligent stock research and financial forecast analyst.

RULES:
1. FACT-CHECKING: Before presenting any figure, cross-reference across sources. Mark ✅ if 3+ sources agree (within 5%). Mark ⚠️ if sources conflict (show range). Mark ❌ if unverifiable.
2. FILTER: Do not dump raw data. Surface only the most credible, most recent, most relevant findings.
3. CONSENSUS: For analyst forecasts, calculate the consensus from all sources found.
4. CITE: Always list sources used at the bottom.
5. HONESTY: If data is unavailable, say so — never fabricate numbers.`;

    const synthesisRes = await getGroqCompletion(groq, {
      messages: [
        { role: 'system', content: 'Output raw JSON only.' },
        {
          role: 'user', content: `${SKILL_RULES}

User question: "${query}"
${context ? `Additional context: ${context}` : ''}

Scraped data from ${scrapedContents.length} sources:
${allContent.slice(0, 8000)}

Analyze and return JSON:
{
  "answer": "Direct, concise answer to the user's question",
  "keyMetrics": [{"metric": "name", "value": "value", "verified": true|false, "sources": ["url1"]}],
  "analystConsensus": {
    "bullTarget": "price or null",
    "baseTarget": "price or null",
    "bearTarget": "price or null",
    "recommendation": "Buy|Sell|Hold|null",
    "numAnalysts": number or null
  } or null,
  "factCheckStatus": "verified|partial|unverified",
  "conflicts": ["description of any conflicting data found"] or [],
  "suggestedFormat": "table|chart_line|chart_bar|prose",
  "tableData": [{"Column1": "Val", ...}] or null,
  "chartData": [{"x": "label", "y": number}] or null,
  "sources": ["url1", "url2"],
  "sourceNames": ["Name1", "Name2"],
  "keyRisks": ["risk1", "risk2"] or [],
  "keyDrivers": ["driver1", "driver2"] or []
}`
        }
      ],
      temperature: 0, max_tokens: 3000,
      response_format: { type: 'json_object' }
    });

    const synthesis = JSON.parse(synthesisRes.choices[0]?.message?.content || '{}');

    return NextResponse.json({
      type: 'research',
      query,
      answer: synthesis.answer || 'Could not synthesize results.',
      keyMetrics: synthesis.keyMetrics || [],
      analystConsensus: synthesis.analystConsensus || null,
      factCheckStatus: synthesis.factCheckStatus || 'unverified',
      conflicts: synthesis.conflicts || [],
      suggestedFormat: synthesis.suggestedFormat || 'prose',
      tableData: synthesis.tableData || null,
      chartData: synthesis.chartData || null,
      sources: synthesis.sources || searchUrls.slice(0, 5),
      sourceNames: synthesis.sourceNames || [],
      keyRisks: synthesis.keyRisks || [],
      keyDrivers: synthesis.keyDrivers || [],
      scrapedCount: scrapedContents.length
    });

  } catch (err: any) {
    console.error('Research Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

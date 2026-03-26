import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import Groq from 'groq-sdk';
import * as fs from 'fs';
import * as path from 'path';

const groqApiKey = process.env.GROQ_API_KEY;

// Load the skill instructions
let SKILL_RULES = '';
try {
    const skillPath = path.join(process.cwd(), '.agent', 'skills', 'SKILL.md');
    SKILL_RULES = fs.readFileSync(skillPath, 'utf-8').split('---').slice(2).join('---').trim();
} catch { SKILL_RULES = 'You are an expert data analyst and stock research analyst.'; }

async function getGroqCompletion(groq: Groq, options: any) {
    const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
    let lastError: any = null;
    for (const model of models) {
        try { return await groq.chat.completions.create({ ...options, model }); }
        catch (err: any) { lastError = err; if (err.status === 429) continue; throw err; }
    }
    throw lastError;
}

async function runSQL(sql: string) {
    const clean = sql.replace(/;+\s*$/, '');
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { query: clean });
    if (error) throw new Error(`SQL Error: ${error.message}`);
    return Array.isArray(data) ? data : (data ? [data] : []);
}

// Detect if a question needs live web research (financial facts, prices, forecasts)
function needsWebResearch(question: string): boolean {
    const triggers = [
        'current price', 'stock price', 'live price', 'today', 'right now', 'analyst', 'target',
        'forecast', 'predict', 'recommendation', 'buy', 'sell', 'hold', 'pe ratio', 'eps',
        'valuation', 'market cap', 'moneycontrol', 'nse', 'bse', 'screener', 'nifty', 'sensex',
        'what is the', 'how much is', 'verify', 'fact check', 'current', 'latest', 'recent',
        'historical stock', 'dividend', 'revenue', 'profit', 'quarterly', 'annual report'
    ];
    const q = question.toLowerCase();
    return triggers.some(t => q.includes(t));
}

// Detect what format the user wants for the response
function detectRequestedFormat(question: string): string {
    const q = question.toLowerCase();
    if (q.includes('show in a table') || q.includes('in table') || q.includes('as a table') || q.includes('tabular')) return 'table';
    if (q.includes('show as a chart') || q.includes('in a chart') || q.includes('visualize') || q.includes('plot')) return 'chart';
    if (q.includes('just tell') || q.includes('briefly') || q.includes('summarize') || q.includes('explain')) return 'prose';
    return 'auto'; // Let AI decide
}

export async function POST(req: Request) {
    try {
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY missing.' }, { status: 400 });

        const { question, tableName, columnsInfo, sampleRows, chatHistory, dashboardMode } = await req.json();
        if (!question || !tableName || !columnsInfo) {
            return NextResponse.json({ error: 'Missing parameters.' }, { status: 400 });
        }

        const groq = new Groq({ apiKey: groqApiKey });
        const requestedFormat = detectRequestedFormat(question);
        const isFinancialQuery = needsWebResearch(question);

        let schemaStr = `Table: "${tableName}"\nColumns:\n`;
        columnsInfo.forEach((c: any) => { schemaStr += `  - "${c.name}" (${c.type})\n`; });

        let sampleDataStr = '';
        if (sampleRows?.length > 0) {
            sampleDataStr = `\nFirst 2 rows:\n${JSON.stringify(sampleRows.slice(0, 2), null, 2)}\n`;
        }

        const historyCtx = (chatHistory || []).slice(-2).map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: ((m.role === 'assistant'
                ? `You previously said: ${(m.narration || m.content || '').slice(0, 300)}`
                : m.content) || '').slice(0, 400)
        }));

        // ── DASHBOARD MODE ──────────────────────────────────────────────────
        if (dashboardMode || question.toLowerCase().includes('dashboard')) {
            const dashRes = await getGroqCompletion(groq, {
                messages: [
                    { role: 'system', content: 'Output raw JSON only.' },
                    { role: 'user', content: `Generate 3 analytical dashboard panels for: "${question}"\nSchema: ${schemaStr}\nReturn: {"dashboardTitle":"...","panels":[{"title":"...","sql":"SELECT ... FROM \\"${tableName}\\" ...","chartType":"bar|line|pie","xAxisKey":"...","yAxisKey":"...","narration":"..."}]}` }
                ],
                temperature: 0, max_tokens: 2000, response_format: { type: 'json_object' }
            });
            const dashData = JSON.parse(dashRes.choices[0]?.message?.content || '{}');
            const panels = [];
            for (const p of (dashData.panels || [])) {
                try { panels.push({ ...p, results: await runSQL(p.sql) }); }
                catch { panels.push({ ...p, results: [] }); }
            }
            return NextResponse.json({ type: 'dashboard', dashboardTitle: dashData.dashboardTitle, panels });
        }

        // ── DEEP INTENT CLASSIFICATION ─────────────────────────────────────
        const intentRes = await getGroqCompletion(groq, {
            messages: [
                {
                    role: 'system', content: `Classify the user's DEEP INTENT for a data analysis request.
Output EXACTLY ONE of: COMPARE | TREND | SUMMARIZE | DISTRIBUTION | RESEARCH | SQL | CHAT

- COMPARE: side-by-side comparison, peer analysis, A vs B
- TREND: time series, historical, growth over time
- SUMMARIZE: executive summary, KPIs, highlights, key metrics overview
- DISTRIBUTION: top N, ranking, breakdown, share, composition
- RESEARCH: live prices, analyst targets, forecasts, news, real-world facts not in dataset
- SQL: targeted data query answerable from the dataset
- CHAT: conversational question, explanation, not a data request`
                },
                { role: 'user', content: `Schema: ${schemaStr}\n${sampleDataStr}\nQuestion: "${question}"\n\nIntent:` }
            ],
            temperature: 0, max_tokens: 10
        });

        let intent = (intentRes.choices[0]?.message?.content?.trim().toUpperCase() || 'SQL').replace(/[^A-Z_]/g, '');
        
        // Override: if financial keywords detected, route to RESEARCH
        if (isFinancialQuery && intent !== 'SQL' && intent !== 'COMPARE') intent = 'RESEARCH';

        console.log(`[Query] "${question}" → intent=${intent} format=${requestedFormat}`);

        // ── RESEARCH: Live web fact-checking pipeline ──────────────────────
        if (intent === 'RESEARCH') {
            try {
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
                const researchRes = await fetch(`${appUrl}/api/research`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: question, context: `Dataset: ${schemaStr}` })
                });
                const researchData = await researchRes.json();

                let finalFormat = requestedFormat === 'auto' ? (researchData.suggestedFormat || 'prose') : requestedFormat;

                return NextResponse.json({
                    type: 'research',
                    narration: researchData.answer,
                    keyMetrics: researchData.keyMetrics || [],
                    analystConsensus: researchData.analystConsensus || null,
                    factCheckStatus: researchData.factCheckStatus,
                    conflicts: researchData.conflicts || [],
                    format: finalFormat,
                    tableData: finalFormat === 'table' ? (researchData.tableData || researchData.keyMetrics?.map((m: any) => ({ Metric: m.metric, Value: m.value, Verified: m.verified ? '✅' : '⚠️' }))) : null,
                    chartData: (finalFormat === 'chart_line' || finalFormat === 'chart_bar') ? researchData.chartData : null,
                    sources: researchData.sources || [],
                    sourceNames: researchData.sourceNames || [],
                    keyRisks: researchData.keyRisks || [],
                    keyDrivers: researchData.keyDrivers || [],
                    followUps: ['What are analyst price targets?', 'Show historical trend', 'Compare P/E with sector peers']
                });
            } catch (err: any) {
                console.warn('Research pipeline failed, falling back to SQL:', err.message);
                intent = 'SQL'; // Fallback
            }
        }

        // ── CHAT ───────────────────────────────────────────────────────────
        if (intent === 'CHAT') {
            const chatRes = await getGroqCompletion(groq, {
                messages: [
                    { role: 'system', content: `${SKILL_RULES}\n\nDataset schema:\n${schemaStr}` },
                    ...historyCtx,
                    { role: 'user', content: question }
                ],
                temperature: 0.7, max_tokens: 800
            });
            return NextResponse.json({ type: 'chat', format: 'prose', content: chatRes.choices[0]?.message?.content?.trim() });
        }

        // ── COMPARE ────────────────────────────────────────────────────────
        if (intent === 'COMPARE') {
            const planRes = await getGroqCompletion(groq, {
                messages: [
                    { role: 'system', content: 'Output raw JSON only.' },
                    { role: 'user', content: `COMPARISON query: "${question}"\nSchema: ${schemaStr}${sampleDataStr}\nReturn: {"sql":"SELECT...","xAxisKey":"...","seriesKeys":["col1","col2"],"seriesLabels":["Label A","Label B"],"narration_plan":"what to highlight"}` }
                ],
                temperature: 0, max_tokens: 800, response_format: { type: 'json_object' }
            });
            const plan = JSON.parse(planRes.choices[0]?.message?.content || '{}');
            let results: any[] = [];
            try { results = await runSQL(plan.sql || `SELECT * FROM "${tableName}" LIMIT 30`); } catch { results = sampleRows || []; }

            const narRes = await getGroqCompletion(groq, {
                messages: [
                    { role: 'system', content: '2-3 sentence expert analyst insight. Direct, not descriptive.' },
                    { role: 'user', content: `User asked: "${question}"\nData: ${JSON.stringify(results.slice(0, 10))}` }
                ],
                temperature: 0.3, max_tokens: 300
            });

            const finalFormat = requestedFormat === 'table' ? 'table' : 'chart_grouped';
            return NextResponse.json({
                type: 'compare', sql: plan.sql, results, format: finalFormat,
                xAxisKey: plan.xAxisKey || Object.keys(results[0] || {})[0],
                seriesKeys: plan.seriesKeys || [Object.keys(results[0] || {})[1]],
                seriesLabels: plan.seriesLabels || plan.seriesKeys || ['Value'],
                narration: narRes.choices[0]?.message?.content?.trim(),
                followUps: ['Which metric has the biggest gap?', 'Rank by performance', 'Show historical trend']
            });
        }

        // ── SQL (TREND, SUMMARIZE, DISTRIBUTION, SQL) ──────────────────────
        // Map intent to SQL guidance
        const intentGuide: Record<string, string> = {
            TREND: 'Order by the date/time column ascending. Include date and value columns.',
            SUMMARIZE: 'Use aggregations: AVG, SUM, COUNT, MAX, MIN to give a meaningful summary. Return key stats.',
            DISTRIBUTION: 'Use GROUP BY and COUNT/SUM. ORDER BY the metric DESC. Return top 15 max.',
            SQL: 'Answer the exact question as directly as possible.'
        };

        const sqlRes = await getGroqCompletion(groq, {
            messages: [
                {
                    role: 'system', content: `PostgreSQL expert. Raw SQL ONLY. Double-quote ALL identifiers. No semicolons.
Schema: ${schemaStr}${sampleDataStr}
Intent: ${intent}. ${intentGuide[intent] || ''}`
                },
                ...historyCtx,
                { role: 'user', content: `Question: "${question}"` }
            ],
            temperature: 0, max_tokens: 600
        });

        let sql = (sqlRes.choices[0]?.message?.content || '').replace(/```sql|```/gi, '').trim().replace(/;+$/, '');
        const results = await runSQL(sql);
        const keys = Object.keys(results[0] || {});

        // Determine best chart type based on intent AND user's requested format
        const autoChartType: Record<string, string> = { TREND: 'line', DISTRIBUTION: 'bar', SUMMARIZE: 'bar', SQL: 'bar' };
        
        let showChart = false;
        let chartType = autoChartType[intent] || 'bar';

        if (requestedFormat === 'chart') showChart = true;
        else if (requestedFormat === 'table') showChart = false;
        else if (requestedFormat === 'prose') showChart = false;
        else {
            // auto: show chart for trends and distributions but not for simple lookups
            showChart = intent === 'TREND' || intent === 'DISTRIBUTION' || (intent === 'SUMMARIZE' && results.length > 2);
        }

        const insightsRes = await getGroqCompletion(groq, {
            messages: [
                { role: 'system', content: 'Output raw JSON only.' },
                {
                    role: 'user', content: `Expert analyst. User asked: "${question}" (intent: ${intent})
Data: ${JSON.stringify(results.slice(0, 10))}
Return: {"narration": "Direct answer to question in 2-3 sentences. Lead with the key insight.", "xAxisKey": "${keys[0] || ''}", "yAxisKey": "${keys[1] || ''}", "followUps": ["follow-up 1", "follow-up 2"]}`
                }
            ],
            temperature: 0.2, max_tokens: 400, response_format: { type: 'json_object' }
        });

        const insights = JSON.parse(insightsRes.choices[0]?.message?.content || '{}');

        return NextResponse.json({
            type: 'sql', sql, results,
            format: requestedFormat === 'auto' ? (showChart ? `chart_${chartType}` : 'table') : requestedFormat,
            narration: insights.narration || 'Query complete.',
            chartConfig: showChart ? { type: chartType, xAxisKey: insights.xAxisKey || keys[0], yAxisKey: insights.yAxisKey || keys[1], title: question } : null,
            followUps: insights.followUps || []
        });

    } catch (err: any) {
        console.error('Query Error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

'use client';

import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';
import { PieChart as RechartsPie } from 'recharts';
import {
  Sparkles, ArrowRight, Link, Upload as UploadIcon, Send, Database, RotateCcw,
  Download, Search, FileText, AlertTriangle, LayoutDashboard, Globe, Plus,
  Menu, X, Terminal, BrainCircuit, BoxSelect, ChevronDown, Check
} from 'lucide-react';

const CHART_COLORS = ['#FFFFFF', '#3b82f6', '#10b981', '#fb923c', '#8b5cf6', '#facc15', '#34d399', '#38bdf8'];
const ChartTooltipStyle = { backgroundColor: '#1a1a1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px', color: '#fff' };

type DatasetInfo = {
  tableName: string;
  fileName: string;
  columnsInfo: any[];
  sampleRows: any[];
  rowCount: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  narration?: string;
  sql?: string;
  results?: any[];
  chartConfig?: any;
  followUps?: string[];
  type?: 'chat' | 'sql' | 'error' | 'dashboard' | 'quality' | 'compare' | 'research';
  dashboardTitle?: string;
  panels?: any[];
  quality?: any;
  format?: string;
  // Compare
  xAxisKey?: string;
  seriesKeys?: string[];
  seriesLabels?: string[];
  // Research
  keyMetrics?: any[];
  analystConsensus?: any;
  factCheckStatus?: string;
  conflicts?: string[];
  keyRisks?: string[];
  keyDrivers?: string[];
  sources?: string[];
  sourceNames?: string[];
  tableData?: any[];
  chartData?: any[];
};

export default function Home() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeDS = datasets[activeIdx];

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [dashboardMode, setDashboardMode] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<'idle' | 'loading'>('idle');



  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isThinking]);

  const addDataset = async (data: any[], name: string) => {
    if (!data?.length) { setErrorMsg('Data empty.'); setUploadState('error'); return; }
    setUploadState('uploading'); setErrorMsg('');

    const firstRow = data[0];
    const columns = Object.keys(firstRow).map(key => ({
      name: key,
      type: typeof firstRow[key] === 'number' ? 'number' : typeof firstRow[key] === 'boolean' ? 'boolean' : 'string'
    }));
    
    const safeName = `ds_${name.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().slice(0, 15)}_${Date.now()}`;
    
    try {
      const res = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: safeName, columns, rows: data })
      });
      const uploadRes = await res.json();
      if (!res.ok) throw new Error(uploadRes.error);

      const newDS: DatasetInfo = { tableName: uploadRes.tableName, fileName: name, columnsInfo: columns, sampleRows: data.slice(0, 3), rowCount: data.length };
      setDatasets(prev => {
        const next = [...prev, newDS];
        setActiveIdx(next.length - 1);
        return next;
      });
      setUploadState('success');

      // AI Quality Analysis
      const qualityRes = await fetch('/api/data-quality', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, sampleRows: data.slice(0, 3) })
      });
      const quality = qualityRes.ok ? await qualityRes.json() : null;

      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant', type: quality ? 'quality' : 'chat',
        content: `**${name}** is loaded and analyzed. I've found ${data.length.toLocaleString()} records across ${columns.length} pillars.\n\nAsk for an analysis or say "generate dashboard".`,
        quality
      }]);
    } catch (err: any) { setErrorMsg(err.message); setUploadState('error'); }
  };

  const handleFileUpload = async (file: File) => {
    const ext = file.name.toLowerCase();
    const name = file.name.replace(/\.[^/.]+$/, '');
    if (ext.endsWith('.csv')) {
      Papa.parse(file, { header: true, skipEmptyLines: true, dynamicTyping: true, complete: (r) => addDataset(r.data, name) });
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          // Auto-pick the sheet with the most rows — no popup ever
          let bestSheet = wb.SheetNames[0];
          let bestCount = 0;
          for (const sheetName of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
            if (rows.length > bestCount) { bestCount = rows.length; bestSheet = sheetName; }
          }
          const finalData = XLSX.utils.sheet_to_json(wb.Sheets[bestSheet], { defval: null });
          if (finalData.length === 0) {
            setErrorMsg('Excel sheet appears to be empty.');
            setUploadState('error');
            return;
          }
          addDataset(finalData, `${name}`);
        } catch (err: any) {
          console.error("Excel parse error:", err);
          setErrorMsg('Failed to parse Excel file. Make sure it is a valid .xlsx or .xls file.');
          setUploadState('error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext.endsWith('.pdf')) {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/ingest-pdf', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) addDataset(data.rows, data.datasetName || name);
      else setErrorMsg(data.error);
    }
  };

  const handleWebSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchState('loading'); setUploadState('uploading');
    try {
      const res = await fetch('/api/search-web', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addDataset(data.rows, data.datasetName || searchQuery.trim().slice(0, 15));
      setSearchQuery(''); setSearchState('loading');
    } catch (err: any) { setErrorMsg(err.message); setUploadState('error'); }
    finally { setSearchState('idle'); }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || !activeDS || isThinking) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages); setInputText(''); setIsThinking(true);
    
    try {
      const res = await fetch('/api/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text, tableName: activeDS.tableName,
          columnsInfo: activeDS.columnsInfo, sampleRows: activeDS.sampleRows,
          chatHistory: newMessages.slice(-2).map(m => ({ role: m.role, content: m.content || m.narration, sql: m.sql })),
          dashboardMode: dashboardMode || text.toLowerCase().includes('dashboard')
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', ...data }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', type: 'error', content: `❌ ${err.message}` }]);
    } finally { setIsThinking(false); }
  };

  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === 'user') return (
      <div key={msg.id} className="message-user">{msg.content}</div>
    );

    const intentLabel: Record<string, string> = {
      sql: 'Data Query', chat: 'Discussion', compare: 'Comparison',
      dashboard: 'Dashboard', quality: 'Quality Check', research: 'Live Research ✦', error: 'Error'
    };
    const fcBadge: Record<string, string> = { verified: '✅ Verified', partial: '⚠️ Partial', unverified: '❌ Unverified' };

    return (
      <div key={msg.id} className="message-ai">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <div className="ai-pill"><Check size={12} /> {intentLabel[msg.type || 'sql'] || 'Analysis'}</div>
          {msg.factCheckStatus && (
            <div className="ai-pill" style={{ background: msg.factCheckStatus === 'verified' ? 'rgba(16,185,129,0.12)' : 'rgba(251,146,60,0.12)', borderColor: msg.factCheckStatus === 'verified' ? 'rgba(16,185,129,0.3)' : 'rgba(251,146,60,0.3)', color: msg.factCheckStatus === 'verified' ? '#10b981' : '#fb923c' }}>
              {fcBadge[msg.factCheckStatus]}
            </div>
          )}
        </div>

        {/* Primary narration */}
        {(msg.content || msg.narration) && (
          <div style={{ fontSize: '1rem', lineHeight: '1.8', color: '#fff', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' }}>
            {msg.content || msg.narration}
          </div>
        )}

        {/* RESEARCH: Analyst Consensus Card */}
        {msg.type === 'research' && msg.analystConsensus && (
          <div className="premium-card" style={{ marginBottom: '1.5rem', borderColor: 'rgba(59,130,246,0.2)' }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#71717a', textTransform: 'uppercase', marginBottom: '1rem' }}>Analyst Consensus</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
              {msg.analystConsensus.bullTarget && <div><div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#10b981' }}>{msg.analystConsensus.bullTarget}</div><div style={{ fontSize: '0.7rem', color: '#71717a' }}>BULL</div></div>}
              {msg.analystConsensus.baseTarget && <div><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{msg.analystConsensus.baseTarget}</div><div style={{ fontSize: '0.7rem', color: '#71717a' }}>BASE</div></div>}
              {msg.analystConsensus.bearTarget && <div><div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fb923c' }}>{msg.analystConsensus.bearTarget}</div><div style={{ fontSize: '0.7rem', color: '#71717a' }}>BEAR</div></div>}
            </div>
            {msg.analystConsensus.recommendation && <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>Rating: <strong>{msg.analystConsensus.recommendation}</strong>{msg.analystConsensus.numAnalysts ? ` (${msg.analystConsensus.numAnalysts} analysts)` : ''}</div>}
          </div>
        )}

        {/* RESEARCH: Key Metrics Table */}
        {msg.type === 'research' && msg.keyMetrics && msg.keyMetrics.length > 0 && (
          <div className="premium-table-container" style={{ marginBottom: '1.5rem' }}>
            <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', color: '#71717a', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>KEY METRICS</div>
            <table>
              <thead><tr><th>Metric</th><th>Value</th><th>Status</th></tr></thead>
              <tbody>{msg.keyMetrics.map((m: any, i: number) => (
                <tr key={i}><td>{m.metric}</td><td style={{ fontWeight: 600 }}>{m.value}</td><td>{m.verified ? '✅' : '⚠️'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {/* RESEARCH: Chart (line for forecasts) */}
        {msg.type === 'research' && msg.chartData && msg.chartData.length > 0 && (msg.format === 'chart_line' || msg.format === 'chart_bar') && (
          <div className="premium-card" style={{ height: '280px', marginBottom: '1.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              {msg.format === 'chart_line' ? (
                <LineChart data={msg.chartData}><XAxis dataKey="x" stroke="#71717a" fontSize={10} /><YAxis stroke="#71717a" fontSize={10} /><Tooltip contentStyle={ChartTooltipStyle} /><Line type="monotone" dataKey="y" stroke="#FFFFFF" strokeWidth={2} dot={{ r: 3 }} /></LineChart>
              ) : (
                <BarChart data={msg.chartData}><XAxis dataKey="x" stroke="#71717a" fontSize={10} /><YAxis stroke="#71717a" fontSize={10} /><Tooltip contentStyle={ChartTooltipStyle} /><Bar dataKey="y" fill="#FFFFFF" radius={[4, 4, 0, 0]} /></BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* RESEARCH: Table data (when user asked for table) */}
        {msg.type === 'research' && msg.tableData && msg.tableData.length > 0 && msg.format === 'table' && (
          <div className="premium-table-container" style={{ marginBottom: '1.5rem' }}>
            <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', color: '#71717a', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>DATA TABLE</div>
            <div style={{ overflowX: 'auto', maxHeight: '300px' }}>
              <table>
                <thead><tr>{Object.keys(msg.tableData[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{msg.tableData.slice(0, 20).map((row: any, i: number) => <tr key={i}>{Object.values(row).map((v: any, j) => <td key={j}>{v?.toString()}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* RESEARCH: Drivers & Risks */}
        {msg.type === 'research' && ((msg.keyDrivers?.length || 0) > 0 || (msg.keyRisks?.length || 0) > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            {(msg.keyDrivers?.length || 0) > 0 && (
              <div className="premium-card">
                <p style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem' }}>📈 Key Drivers</p>
                {msg.keyDrivers?.map((d, i) => <p key={i} style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: '#a1a1aa' }}>• {d}</p>)}
              </div>
            )}
            {(msg.keyRisks?.length || 0) > 0 && (
              <div className="premium-card">
                <p style={{ fontSize: '0.7rem', color: '#fb923c', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem' }}>⚠️ Key Risks</p>
                {msg.keyRisks?.map((r, i) => <p key={i} style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: '#a1a1aa' }}>• {r}</p>)}
              </div>
            )}
          </div>
        )}

        {/* RESEARCH: Conflicts flagged */}
        {msg.conflicts && msg.conflicts.length > 0 && (
          <div className="premium-card" style={{ marginBottom: '1rem', borderColor: 'rgba(251,146,60,0.3)' }}>
            <p style={{ fontSize: '0.75rem', color: '#fb923c', fontWeight: 600, marginBottom: '0.5rem' }}>⚠️ Data Conflicts Detected</p>
            {msg.conflicts.map((c, i) => <p key={i} style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>• {c}</p>)}
          </div>
        )}

        {/* RESEARCH: Source Citations */}
        {msg.type === 'research' && msg.sources && msg.sources.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.65rem', color: '#71717a', marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Sources</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {msg.sources.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: '#71717a', background: 'rgba(255,255,255,0.04)', padding: '0.3rem 0.7rem', borderRadius: '12px', textDecoration: 'none', border: '1px solid var(--border)' }}>
                  {msg.sourceNames?.[i] || new URL(url).hostname.replace('www.', '')}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Data Quality Card */}
        {msg.quality && (
          <div className="premium-card" style={{ marginBottom: '1.5rem', borderColor: msg.quality.score >= 80 ? 'rgba(16, 185, 129, 0.4)' : msg.quality.score >= 50 ? 'rgba(251, 146, 60, 0.4)' : 'rgba(239, 68, 68, 0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Data Quality Score</span>
              <span style={{ 
                color: msg.quality.score >= 80 ? '#10b981' : msg.quality.score >= 50 ? '#fb923c' : '#ef4444', 
                fontWeight: 800, fontSize: '1.5rem' 
              }}>
                {msg.quality.score}%
              </span>
            </div>
            {msg.quality.summary && <p style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '1rem' }}>{msg.quality.summary}</p>}
            
            {(msg.quality.issues?.length > 0 || msg.quality.insights?.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                {msg.quality.issues && msg.quality.issues.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#fb923c', textTransform: 'uppercase', fontWeight: 700 }}>⚠️ Issues Detected</span>
                    <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem', fontSize: '0.8rem', color: '#a1a1aa' }}>
                      {msg.quality.issues.map((i: any, idx: number) => (
                        <li key={idx} style={{ marginBottom: '0.4rem' }}>
                          <strong style={{ color: '#e4e4e7' }}>{i.column}</strong>: {i.issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {msg.quality.insights && msg.quality.insights.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#3b82f6', textTransform: 'uppercase', fontWeight: 700 }}>💡 Quick Insights</span>
                    <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem', fontSize: '0.8rem', color: '#a1a1aa' }}>
                      {msg.quality.insights.map((insight: string, idx: number) => (
                        <li key={idx} style={{ marginBottom: '0.4rem' }}>{insight}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* COMPARE: Grouped Bar Chart */}
        {msg.type === 'compare' && msg.format !== 'table' && msg.results && msg.results.length > 0 && msg.seriesKeys && (
          <div className="premium-card" style={{ height: '380px', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', marginBottom: '1rem' }}>Side-by-Side Comparison</p>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={msg.results} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
                <XAxis dataKey={msg.xAxisKey} stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" />
                <YAxis stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={ChartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                {(msg.seriesKeys || []).map((key, i) => (
                  <Bar key={key} dataKey={key} name={msg.seriesLabels?.[i] || key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Standard Chart: only shown when format says so */}
        {msg.type !== 'compare' && msg.type !== 'research' && msg.chartConfig && msg.format && msg.format.startsWith('chart') && (
          <div className="premium-card" style={{ height: '320px', marginBottom: '1.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              {msg.chartConfig.type === 'line' ? (
                <LineChart data={msg.results} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis dataKey={msg.chartConfig.xAxisKey} stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Line type="monotone" dataKey={msg.chartConfig.yAxisKey} stroke="#FFFFFF" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              ) : msg.chartConfig.type === 'pie' ? (
                <PieChart><Pie data={msg.results} dataKey={msg.chartConfig.yAxisKey} nameKey={msg.chartConfig.xAxisKey} cx="50%" cy="50%" outerRadius={100} label>
                  {(msg.results || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie><Tooltip contentStyle={ChartTooltipStyle} /></PieChart>
              ) : (
                <BarChart data={msg.results} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis dataKey={msg.chartConfig.xAxisKey} stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Bar dataKey={msg.chartConfig.yAxisKey} fill="#FFFFFF" radius={[6, 6, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* Data Table — shows for sql/compare when format is table or auto */}
        {msg.type !== 'research' && msg.results && msg.results.length > 0 && (msg.format === 'table' || !msg.format || !msg.format.startsWith('chart')) && (
          <div className="premium-table-container" style={{ marginBottom: '1.5rem' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', fontSize: '0.7rem', color: '#71717a', borderBottom: '1px solid var(--border)' }}>
              {msg.results.length} ROWS
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '300px' }}>
              <table>
                <thead><tr>{Object.keys(msg.results[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{msg.results.slice(0, 20).map((row, i) => (<tr key={i}>{Object.values(row).map((v: any, j) => <td key={j}>{v?.toString()}</td>)}</tr>))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dashboard Panels */}
        {msg.type === 'dashboard' && (
          <div className="dash-grid">
            {(msg.panels || []).map((p: any, i: number) => (
              <div key={i} className="premium-card">
                <p style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.6, marginBottom: '1rem', textTransform: 'uppercase' }}>{p.title}</p>
                {p.results && p.results.length > 0 ? (
                  <div style={{ height: '200px' }}><ResponsiveContainer width="100%" height="100%"><BarChart data={p.results}><XAxis dataKey={p.xAxisKey} hide /><Bar dataKey={p.yAxisKey} fill="#FFF" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                ) : <p style={{ fontSize: '0.8rem', color: '#ff4b4b' }}>Query failed.</p>}
              </div>
            ))}
          </div>
        )}

        {/* SQL Source */}
        {msg.sql && (
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ fontSize: '0.75rem', color: '#71717a', cursor: 'pointer', padding: '0.5rem 0' }}>View SQL</summary>
            <pre style={{ background: '#0a0a0b', padding: '1.25rem', borderRadius: '16px', fontSize: '0.8rem', color: '#c084fc', border: '1px solid var(--border)', marginTop: '0.5rem' }}>{msg.sql}</pre>
          </details>
        )}

        {/* Follow-up chips */}
        {msg.followUps && msg.followUps.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
            {msg.followUps.map((q, i) => (
              <button key={i} onClick={() => sendMessage(q)}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', padding: '0.4rem 0.9rem', fontSize: '0.8rem', color: '#a1a1aa', cursor: 'pointer' }}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-wrapper">
      <aside className="sidebar" style={{ transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', display: sidebarOpen ? 'flex' : 'none' }}>
        <div style={{ marginBottom: '3rem' }}>
          <h2 className="metallic-text" style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>DataSense.</h2>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', marginBottom: '1rem', paddingLeft: '0.5rem' }}>Active Workspace</p>
          {datasets.map((ds, i) => (
            <div key={i} className={`dataset-item ${i === activeIdx ? 'active' : ''}`} onClick={() => setActiveIdx(i)}>
              <div className="icon"><Database size={14} /></div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{ds.fileName}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>{ds.rowCount.toLocaleString()} units</div>
              </div>
            </div>
          ))}

          <button className="pill-btn-secondary" style={{ width: '100%', marginTop: '0.75rem', padding: '0.6rem', borderStyle: 'dashed' }}
            onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.xlsx,.xls,.pdf'; inp.onchange = (e: any) => handleFileUpload(e.target.files[0]); inp.click(); }}>
            <Plus size={14} style={{ marginRight: '0.4rem' }} /> Add Dataset
          </button>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
          <button className="pill-btn-secondary" style={{ width: '100%', fontSize: '0.75rem', opacity: 0.6 }} onClick={() => { setDatasets([]); setMessages([]); }}>Reset Workspace</button>
        </div>
      </aside>

      <main className="main-view">
        <header style={{ padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className={`pill-btn-secondary ${dashboardMode ? 'active' : ''}`} style={{ borderColor: dashboardMode ? '#fff' : 'rgba(255,255,255,0.1)', cursor: 'pointer' }} onClick={() => setDashboardMode(!dashboardMode)}>
              <LayoutDashboard size={14} style={{ marginRight: '0.4rem' }} /> Dashboard
            </div>
          </div>
        </header>

        <div className="chat-scroll">
          {datasets.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
              <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '2rem' }}>
                <BrainCircuit size={48} color="rgba(255,255,255,0.2)" />
              </div>
              <h1 className="metallic-text" style={{ fontSize: '3rem', marginBottom: '0.75rem', letterSpacing: '-0.03em' }}>Explore anything.</h1>
              <p style={{ color: '#71717a', fontSize: '1.1rem', maxWidth: '400px', marginBottom: '3rem', lineHeight: '1.6' }}>Upload data or live-search the web to start your AI analytics journey.</p>
              
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="pill-btn" onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.xlsx,.xls,.pdf'; inp.onchange = (e: any) => handleFileUpload(e.target.files[0]); inp.click(); }}>
                  <UploadIcon size={16} /> Upload Data
                </button>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '25px', padding: '0.35rem 0.5rem', width: '300px' }}>
                  <input type="text" placeholder="Live search..." style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', padding: '0 1rem', fontSize: '0.85rem' }} 
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleWebSearch()} />
                  <button onClick={handleWebSearch} className="send-btn" style={{ width: 34, height: 34 }}><Search size={14} /></button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              {messages.map(renderMessage)}
              {isThinking && <div className="ai-pill" style={{ marginLeft: '2rem' }}><Sparkles size={12} /> AI Analyst is thinking...</div>}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Floating Input */}
        {activeDS && (
          <form className="floating-input-bar" onSubmit={(e) => { e.preventDefault(); sendMessage(inputText); }}>
            <input 
              ref={inputRef}
              type="text" 
              placeholder={`Analyze ${activeDS.fileName}...`}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isThinking}
            />
            <button type="submit" className="send-btn" disabled={isThinking || !inputText.trim()}>
              <ArrowRight size={20} />
            </button>
          </form>
        )}
      </main>


    </div>
  );
}

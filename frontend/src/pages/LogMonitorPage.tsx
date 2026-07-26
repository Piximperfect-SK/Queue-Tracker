import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal, Shield, Wifi, CheckCircle2, XCircle, AlertCircle,
  Activity, Radio, RefreshCw, Clock, Database, Server, Filter,
  Zap
} from 'lucide-react';
import { AreaChart, Area, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { socket } from '../utils/socket';
import type { LogEntry } from '../types';
import { getLogsForDate, saveSingleLogFromServer } from '../utils/logger';

const PING_LIMIT    = 40;
const API_LIMIT     = 30;
const LOG_LIMIT     = 200;
const PING_INTERVAL = 3000;
const API_INTERVAL  = 5000;

interface ApiCheck { ts: number; status: number | null; time: number | null; size: number | null; }

const safeN = (arr: number[]) => arr.filter(v => v >= 0);
const avg   = (arr: number[]) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;

function useTopOffset() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const update = () => {
      const el = document.querySelector('nav') || document.querySelector('header');
      setTop(el ? Math.ceil((el as HTMLElement).getBoundingClientRect().bottom) : 0);
    };
    update();
    window.addEventListener('resize', update);
    const obs = new MutationObserver(update);
    obs.observe(document.body, { attributes: true, childList: true, subtree: true });
    return () => { window.removeEventListener('resize', update); obs.disconnect(); };
  }, []);
  return top;
}

// ── CSS-var helpers so every element reads from the theme ────────────────
const S = {
  bg:          { background: 'var(--mon-bg)' },
  surface:     { background: 'var(--mon-surface)' },
  surface2:    { background: 'var(--mon-surface2)' },
  border:      { borderColor: 'var(--mon-border)' },
  border2:     { borderColor: 'var(--mon-border2)' },
  text:        { color: 'var(--mon-text)' },
  text2:       { color: 'var(--mon-text2)' },
  text3:       { color: 'var(--mon-text3)' },
  text4:       { color: 'var(--mon-text4)' },
  text5:       { color: 'var(--mon-text5)' },
  teal:        { color: 'var(--mon-teal)' },
  tealBg:      { background: 'var(--mon-teal-bg)', borderColor: 'var(--mon-teal-border)', color: 'var(--mon-teal)' },
  chartBg:     { background: 'var(--mon-chart-bg)' },
  statBg:      { background: 'var(--mon-stat-bg)', borderColor: 'var(--mon-stat-border)' },
  footerBg:    { background: 'var(--mon-footer-bg)' },
  inputBg:     { background: 'var(--mon-input-bg)', borderColor: 'var(--mon-border)', color: 'var(--mon-text2)' },
  btnBg:       { background: 'var(--mon-btn-bg)', borderColor: 'var(--mon-border)', color: 'var(--mon-btn-text)' },
};

// Merge styles helper
const ms = (...s: React.CSSProperties[]) => Object.assign({}, ...s);

// ── Sub-components ───────────────────────────────────────────────────────
const ChartTip = ({ active, payload }: any) => {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div style={ms(S.surface2, { border: '1px solid var(--mon-border)', color: 'var(--mon-text)', borderRadius: 6, padding: '2px 8px', fontSize: 9, fontWeight: 700 })}>
      {payload[0].value}ms
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; valueStyle?: React.CSSProperties }> = ({ label, value, valueStyle }) => (
  <div style={ms(S.statBg, { borderWidth: 1, borderStyle: 'solid', borderRadius: 8, padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 })}>
    <span style={ms(S.text4, { fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', lineHeight: 1 })}>{label}</span>
    <span style={ms(S.text, { fontSize: 13, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, ...valueStyle })}>{value}</span>
  </div>
);

const Pill: React.FC<{ ok: boolean | null; labelOk: string; labelFail: string }> = ({ ok, labelOk, labelFail }) => {
  if (ok === null) return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:999, background:'var(--mon-muted)', border:'1px solid var(--mon-border)', color:'var(--mon-text4)', fontSize:8, fontWeight:700 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--mon-text4)' }} />WAITING
    </span>
  );
  return ok ? (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 font-bold" style={{ fontSize:8 }}>
      <CheckCircle2 size={9} />{labelOk}
    </span>
  ) : (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-500 font-bold" style={{ fontSize:8 }}>
      <XCircle size={9} />{labelFail}
    </span>
  );
};

const MiniChart: React.FC<{ samples: number[]; color: string; gradId: string; empty?: React.ReactNode }> = ({ samples, color, gradId, empty }) => (
  <div style={ms(S.chartBg, { flex: 1, minHeight: 0, position: 'relative', borderRadius: 12, border: '1px solid var(--mon-border2)', overflow: 'hidden' })}>
    {(!samples.length || samples.every(v => v < 0)) && empty && (
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', zIndex:10 }}>{empty}</div>
    )}
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={samples.map(v => ({ v: v < 0 ? null : v }))} margin={{ top:6, right:6, bottom:2, left:6 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="var(--mon-chart-grid)" />
        <YAxis hide domain={[0,'auto']} />
        <Tooltip content={<ChartTip />} cursor={{ stroke:'var(--mon-border)', strokeWidth:1 }} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
const LogMonitorPage: React.FC = () => {
  const topOffset  = useTopOffset();
  const scrollRef  = useRef<HTMLDivElement>(null);
  const runPingRef = useRef<() => void>(() => {});
  const runApiRef  = useRef<() => void>(() => {});
  const today      = () => new Date().toISOString().split('T')[0];

  const [monitoredDate, setMonitoredDate] = useState(today);
  const [logs,          setLogs]          = useState<LogEntry[]>(() => getLogsForDate(today()));
  const [showNavLogs,   setShowNavLogs]   = useState(true);
  const [filterType,    setFilterType]    = useState<'all'|'positive'|'negative'|'neutral'>('all');

  const [pingSamples,  setPingSamples]  = useState<number[]>([]);
  const [lastPing,     setLastPing]     = useState<number|null>(null);
  const [pingChecking, setPingChecking] = useState(false);

  const backendBase = (import.meta.env.VITE_BACKEND_URL || window.location.origin).replace(/\/$/, '');
  const [apiUrl,        setApiUrl]        = useState(`${backendBase}/health`);
  const [apiSamples,    setApiSamples]    = useState<number[]>([]);
  const [lastApiStatus, setLastApiStatus] = useState<number|null>(null);
  const [lastApiSize,   setLastApiSize]   = useState<number|null>(null);
  const [recentChecks,  setRecentChecks]  = useState<ApiCheck[]>([]);
  const [apiChecking,   setApiChecking]   = useState(false);

  // ── socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = ({ dateStr, logEntry }: { dateStr: string; logEntry: LogEntry }) => {
      try { saveSingleLogFromServer(dateStr, logEntry); } catch {}
      if (dateStr === monitoredDate) setLogs(prev => [...prev, logEntry].slice(-LOG_LIMIT));
    };
    socket.on('log_added', handle);
    return () => void socket.off('log_added', handle);
  }, [monitoredDate]);

  useEffect(() => { setLogs(getLogsForDate(monitoredDate)); }, [monitoredDate]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  // ── ping ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setPingChecking(true);
      const start = performance.now();
      try {
        await fetch(`${window.location.origin}/?__ping=${Date.now()}`, { cache:'no-store' });
        const rtt = Math.max(0, Math.round(performance.now() - start));
        if (!alive) return;
        setLastPing(rtt);
        setPingSamples(p => [...p, rtt].slice(-PING_LIMIT));
      } catch {
        if (!alive) return;
        setLastPing(null);
        setPingSamples(p => [...p, -1].slice(-PING_LIMIT));
      } finally { if (alive) setPingChecking(false); }
    };
    runPingRef.current = run; run();
    const id = setInterval(run, PING_INTERVAL);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ── API health ────────────────────────────────────────────────────
  const runApi = useCallback(async () => {
    if (!apiUrl) return;
    setApiChecking(true);
    const start = performance.now();
    try {
      const res  = await fetch(apiUrl, { cache:'no-store' });
      const time = Math.max(0, Math.round(performance.now() - start));
      let size: number|null = null, body = '';
      try { body = await res.text(); size = new Blob([body]).size; } catch {}
      const isHtml = (res.headers.get('content-type')||'').includes('text/html') && /<html/i.test(body);
      const ok = res.ok && !isHtml;
      setLastApiStatus(res.status); setLastApiSize(size);
      if (ok) {
        setApiSamples(p => [...p, time].slice(-API_LIMIT));
        setRecentChecks(p => [{ ts:Date.now(), status:res.status, time, size }, ...p].slice(0,15));
      } else {
        setApiSamples(p => [...p, -1].slice(-API_LIMIT));
        setRecentChecks(p => [{ ts:Date.now(), status:res.status, time:null, size }, ...p].slice(0,15));
      }
    } catch {
      setLastApiStatus(null); setLastApiSize(null);
      setApiSamples(p => [...p, -1].slice(-API_LIMIT));
      setRecentChecks(p => [{ ts:Date.now(), status:null, time:null, size:null }, ...p].slice(0,15));
    } finally { setApiChecking(false); }
  }, [apiUrl]);

  useEffect(() => { runApiRef.current = runApi; runApi(); const id = setInterval(runApi, API_INTERVAL); return () => clearInterval(id); }, [runApi]);

  // ── derived ────────────────────────────────────────────────────────
  const lastApiSample = apiSamples.at(-1) ?? null;
  const apiOnline     = lastApiSample !== null && lastApiSample >= 0;
  const apiHasData    = apiSamples.length > 0;
  const goodN         = safeN(pingSamples);
  const pingLoss      = pingSamples.length ? Math.round((pingSamples.filter(v=>v<0).length/pingSamples.length)*100) : null;
  const jitterVal     = goodN.length < 2 ? null : Math.round(safeN(goodN.slice(1).map((v,i)=>Math.abs(v-goodN[i]))).reduce((a,b)=>a+b,0)/(goodN.length-1));

  const visibleLogs = logs
    .filter(l => showNavLogs || (!/navigate/i.test(l.action) && !/visited/i.test(l.details)))
    .filter(l => filterType === 'all' || l.type === filterType);

  const filterColors: Record<string, { bg: string; text: string }> = {
    all:      { bg:'var(--mon-tag-all-bg)',    text:'var(--mon-tag-all-text)' },
    positive: { bg:'rgba(16,185,129,0.15)',    text:'rgb(16,185,129)' },
    negative: { bg:'rgba(239,68,68,0.15)',     text:'rgb(239,68,68)' },
    neutral:  { bg:'var(--mon-muted)',         text:'var(--mon-text3)' },
  };

  // ── Row left-border colours stay the same in both themes ──────────
  const rowBorder = (log: LogEntry) =>
    log.type === 'positive' ? 'rgba(16,185,129,0.55)'
    : log.type === 'negative' ? 'rgba(239,68,68,0.55)'
    : 'var(--mon-border)';

  const logText = (log: LogEntry) =>
    log.type === 'positive' ? { action:'rgb(16,185,129)', detail:'rgba(16,185,129,0.70)' }
    : log.type === 'negative' ? { action:'rgb(239,68,68)', detail:'rgba(239,68,68,0.70)' }
    : { action:'var(--mon-text3)', detail:'var(--mon-text2)' };

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div
      style={ms(S.bg, {
        position:'fixed', left:0, right:0, bottom:0, top:`${topOffset}px`,
        display:'flex', flexDirection:'column', overflow:'hidden',
        fontFamily:"'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace",
      })}
    >
      {/* ═══ TOPBAR ═══════════════════════════════════════════════════ */}
      <div style={ms(S.surface, { height:44, borderBottom:'1px solid var(--mon-border)', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', flexShrink:0 })}>
        {/* Left */}
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          {/* Logo */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={ms(S.tealBg, { width:28, height:28, borderRadius:8, border:'1px solid var(--mon-teal-border)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 12px rgba(0,173,181,0.15)' })}>
              <Terminal size={13} style={S.teal} />
            </div>
            <div style={{ lineHeight:1 }}>
              <p style={ms(S.text4, { fontSize:8, letterSpacing:'0.25em', textTransform:'uppercase', marginBottom:2 })}>Queue Tracker</p>
              <p style={ms(S.text, { fontSize:11, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase' })}>System Monitor</p>
            </div>
          </div>

          <div style={{ width:1, height:24, background:'var(--mon-border)' }} />

          {/* Live */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ position:'relative', width:8, height:8 }}>
              <div className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-40" />
              <div style={{ width:8, height:8, borderRadius:'50%', background:'rgb(52,211,153)' }} />
            </div>
            <span style={{ fontSize:9, fontWeight:700, color:'rgb(52,211,153)', letterSpacing:'0.2em', textTransform:'uppercase' }}>Live</span>
          </div>

          {/* Socket */}
          <div style={ms(socket.connected ? S.tealBg : {}, {
            display:'flex', alignItems:'center', gap:6,
            padding:'4px 10px', borderRadius:999, border:'1px solid',
            borderColor: socket.connected ? 'var(--mon-teal-border)' : 'rgba(239,68,68,0.3)',
            background: socket.connected ? 'var(--mon-teal-bg)' : 'rgba(239,68,68,0.1)',
            color: socket.connected ? 'var(--mon-teal)' : 'rgb(248,113,113)',
            fontSize:9, fontWeight:700, letterSpacing:'0.15em',
          })}>
            <Radio size={9} />
            {socket.connected ? `SOCKET · ${socket.id?.slice(0,6).toUpperCase()}` : 'SOCKET LOST'}
          </div>
        </div>

        {/* Right */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Date */}
          <div style={ms(S.surface2, { display:'flex', alignItems:'center', gap:8, border:'1px solid var(--mon-border)', borderRadius:8, padding:'0 10px', height:28 })}>
            <Clock size={10} style={S.text4} />
            <input
              type="date" value={monitoredDate}
              onChange={e => setMonitoredDate(e.target.value)}
              style={{ background:'transparent', fontSize:10, outline:'none', cursor:'pointer', width:112, color:'var(--mon-text2)', colorScheme:'auto' }}
            />
          </div>

          {/* Filter bar */}
          <div style={ms(S.surface2, { display:'flex', alignItems:'center', gap:4, border:'1px solid var(--mon-border)', borderRadius:8, padding:'0 4px', height:28 })}>
            <Filter size={9} style={ms(S.text4, { marginLeft:4 })} />
            {(['all','positive','negative','neutral'] as const).map(t => {
              const active = filterType === t;
              const fc = filterColors[t];
              return (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  padding:'0 8px', height:20, borderRadius:6, border:'none', cursor:'pointer',
                  fontSize:8, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em',
                  transition:'all 0.15s',
                  background: active ? fc.bg : 'transparent',
                  color: active ? fc.text : 'var(--mon-text4)',
                }}>
                  {t === 'all' ? 'All' : t === 'positive' ? '✓' : t === 'negative' ? '✗' : '○'}
                </button>
              );
            })}
          </div>

          {/* Nav toggle */}
          <button onClick={() => setShowNavLogs(s => !s)} style={{
            padding:'0 12px', height:28, borderRadius:8, cursor:'pointer',
            border:'1px solid', borderColor: showNavLogs ? 'var(--mon-border)' : 'var(--mon-teal-border)',
            background: showNavLogs ? 'var(--mon-btn-bg)' : 'var(--mon-teal-bg)',
            color: showNavLogs ? 'var(--mon-btn-text)' : 'var(--mon-teal)',
            fontSize:9, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', transition:'all 0.15s',
          }}>
            {showNavLogs ? 'Hide Nav' : 'Nav Hidden'}
          </button>
        </div>
      </div>

      {/* ═══ BODY ═════════════════════════════════════════════════════ */}
      <div style={{ flex:1, minHeight:0, display:'flex', overflow:'hidden' }}>

        {/* ── LEFT: Log stream (58%) ─────────────────────────────── */}
        <div style={{ width:'58%', display:'flex', flexDirection:'column', borderRight:'1px solid var(--mon-border3)' }}>
          {/* Sub-header */}
          <div style={ms(S.surface, { height:32, borderBottom:'1px solid var(--mon-border2)', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', flexShrink:0 })}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Database size={10} style={S.text4} />
              <span style={ms(S.text3, { fontSize:9, fontWeight:700, letterSpacing:'0.2em', textTransform:'uppercase' })}>Event Stream</span>
            </div>
            <span style={ms(S.text5, { fontSize:8, fontVariantNumeric:'tabular-nums' })}>{visibleLogs.length} events</span>
          </div>

          {/* Log entries */}
          <div ref={scrollRef} className="mon-scrollbar" style={{ flex:1, minHeight:0, overflowY:'auto', padding:'4px 0' }}>
            {visibleLogs.length === 0 ? (
              <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, opacity:0.15 }}>
                <Shield size={36} strokeWidth={1} style={S.text} />
                <p className="animate-pulse" style={ms(S.text, { fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4em' })}>No Events</p>
              </div>
            ) : visibleLogs.map((log, i) => {
              const lc = logText(log);
              return (
                <div key={i} style={{
                  display:'flex', alignItems:'center', fontSize:10,
                  margin:'1px 8px', padding:'3px 8px', borderRadius:6,
                  borderLeft:`2px solid ${rowBorder(log)}`,
                  cursor:'default', transition:'background 0.1s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mon-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={ms(S.text4, { flexShrink:0, width:76, fontVariantNumeric:'tabular-nums', fontSize:8.5 })}>{log.timestamp}</span>
                  <span style={{ flexShrink:0, fontWeight:700, width:88, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:8.5, color:'var(--mon-teal-text)' }}>{log.user}</span>
                  <span style={{ flexShrink:0, fontWeight:900, textTransform:'uppercase', width:108, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:8.5, color:lc.action }}>{log.action}</span>
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:9.5, color:lc.detail }}>{log.details}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Diagnostics (42%) ───────────────────────────── */}
        <div style={{ width:'42%', display:'flex', flexDirection:'column' }}>

          {/* ┌─ PING ─────────────────────────────────────────────── */}
          <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', borderBottom:'1px solid var(--mon-border3)', padding:12, gap:8 }}>
            {/* Header */}
            <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={ms(S.tealBg, { width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid var(--mon-teal-border)' })}>
                  <Wifi size={12} style={S.teal} />
                </div>
                <div style={{ lineHeight:1 }}>
                  <p style={ms(S.text, { fontSize:11, fontWeight:900, marginBottom:2 })}>Network Latency</p>
                  <p style={ms(S.text4, { fontSize:8, letterSpacing:'0.12em' })}>Frontend round-trip</p>
                </div>
                {pingLoss !== null && pingLoss > 10 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-500 font-bold" style={{ fontSize:8 }}>
                    <AlertCircle size={8} />{pingLoss}% LOSS
                  </span>
                )}
              </div>
              <button onClick={() => runPingRef.current()} disabled={pingChecking} style={ms(S.btnBg, {
                display:'flex', alignItems:'center', gap:6, padding:'4px 10px',
                border:'1px solid var(--mon-border)', borderRadius:7, cursor:'pointer',
                fontSize:9, transition:'all 0.15s', opacity: pingChecking ? 0.5 : 1,
              })}>
                <RefreshCw size={9} className={pingChecking ? 'animate-spin' : ''} />Ping
              </button>
            </div>

            {/* Stats */}
            <div style={{ flexShrink:0, display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:5 }}>
              <StatCard label="Last"   value={lastPing !== null ? `${lastPing}ms` : '—'} valueStyle={lastPing !== null && lastPing > 200 ? { color:'rgb(251,191,36)' } : undefined} />
              <StatCard label="Avg"    value={avg(goodN) !== null ? `${avg(goodN)}ms` : '—'} />
              <StatCard label="Min"    value={goodN.length ? `${Math.min(...goodN)}ms` : '—'} valueStyle={{ color:'rgb(52,211,153)' }} />
              <StatCard label="Max"    value={goodN.length ? `${Math.max(...goodN)}ms` : '—'} valueStyle={{ color:'rgb(248,113,113)' }} />
              <StatCard label="Loss"   value={pingLoss !== null ? `${pingLoss}%` : '—'} valueStyle={pingLoss !== null && pingLoss > 5 ? { color:'rgb(251,191,36)' } : undefined} />
              <StatCard label="Jitter" value={jitterVal !== null ? `${jitterVal}ms` : '—'} />
            </div>

            <MiniChart samples={pingSamples} color="var(--mon-teal)" gradId="pingG"
              empty={<span style={ms(S.text5, { fontSize:9, textTransform:'uppercase', letterSpacing:'0.15em' })}>Sampling…</span>}
            />

            <div style={{ flexShrink:0, display:'flex', justifyContent:'space-between' }}>
              <span style={ms(S.text5, { fontSize:8 })}>Failures: {pingSamples.filter(v=>v<0).length}</span>
              <span style={ms(S.text5, { fontSize:8 })}>Samples: {pingSamples.length} / {PING_LIMIT}</span>
            </div>
          </div>

          {/* ┌─ API HEALTH ───────────────────────────────────────── */}
          <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', padding:12, gap:8 }}>
            {/* Header */}
            <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{
                  width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center',
                  border:'1px solid',
                  borderColor: !apiHasData ? 'var(--mon-border)' : apiOnline ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)',
                  background:  !apiHasData ? 'var(--mon-muted)' : apiOnline ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                }}>
                  <Server size={12} style={{ color: !apiHasData ? 'var(--mon-text4)' : apiOnline ? 'rgb(52,211,153)' : 'rgb(248,113,113)' }} />
                </div>
                <div style={{ lineHeight:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                    <p style={ms(S.text, { fontSize:11, fontWeight:900 })}>API Health</p>
                    <Pill ok={!apiHasData ? null : apiOnline} labelOk="ONLINE" labelFail="OFFLINE" />
                  </div>
                  <p style={ms(S.text4, { fontSize:8, letterSpacing:'0.12em' })}>Backend /health endpoint</p>
                </div>
              </div>
              <button onClick={runApi} disabled={apiChecking} style={ms(S.btnBg, {
                display:'flex', alignItems:'center', gap:6, padding:'4px 10px',
                border:'1px solid var(--mon-border)', borderRadius:7, cursor:'pointer',
                fontSize:9, transition:'all 0.15s', opacity: apiChecking ? 0.5 : 1,
              })}>
                <RefreshCw size={9} className={apiChecking ? 'animate-spin' : ''} />Check
              </button>
            </div>

            {/* URL row */}
            <div style={ms(S.inputBg, { flexShrink:0, display:'flex', alignItems:'center', gap:6, border:'1px solid var(--mon-border)', borderRadius:8, padding:'0 8px', height:28 })}>
              <Activity size={9} style={S.text4} />
              <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} style={{ flex:1, background:'transparent', fontSize:9, outline:'none', color:'var(--mon-text2)' }} placeholder="https://your-backend/health" />
            </div>

            {/* Stats */}
            <div style={{ flexShrink:0, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:5 }}>
              <StatCard
                label="HTTP Status"
                value={!apiHasData ? '—' : lastApiStatus === null ? 'No resp' : String(lastApiStatus)}
                valueStyle={apiHasData && lastApiStatus !== null && lastApiStatus >= 200 && lastApiStatus < 300 ? { color:'rgb(52,211,153)' } : apiHasData ? { color:'rgb(248,113,113)' } : undefined}
              />
              <StatCard
                label="Last RTT"
                value={!apiHasData ? '—' : lastApiSample !== null && lastApiSample >= 0 ? `${lastApiSample}ms` : 'Timeout'}
              />
              <StatCard label="Payload" value={lastApiSize !== null ? `${lastApiSize}B` : '—'} />
            </div>

            <MiniChart
              samples={apiSamples}
              color={apiOnline ? 'rgb(52,211,153)' : 'rgb(248,113,113)'}
              gradId="apiG"
              empty={<span style={ms(S.text5, { fontSize:9, textTransform:'uppercase', letterSpacing:'0.15em' })}>Awaiting first check…</span>}
            />

            {/* Recent checks */}
            <div style={{ flexShrink:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <p style={ms(S.text4, { fontSize:8, textTransform:'uppercase', letterSpacing:'0.2em' })}>Recent Checks</p>
                <p style={ms(S.text5, { fontSize:8, fontVariantNumeric:'tabular-nums' })}>{recentChecks.length} logged</p>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                {recentChecks.length === 0 ? (
                  <p style={ms(S.text5, { fontSize:8 })}>No checks yet…</p>
                ) : recentChecks.slice(0,6).map((r, i) => {
                  const ok = r.status !== null && r.status >= 200 && r.status < 300;
                  return (
                    <div key={i} style={{
                      display:'flex', alignItems:'center', gap:8, padding:'2px 8px', borderRadius:5, fontSize:8.5,
                      background: ok ? 'rgba(52,211,153,0.05)' : 'rgba(248,113,113,0.05)',
                    }}>
                      {ok ? <CheckCircle2 size={9} style={{ color:'rgb(52,211,153)', flexShrink:0 }} />
                        : r.status ? <AlertCircle size={9} style={{ color:'rgb(251,191,36)', flexShrink:0 }} />
                        : <XCircle size={9} style={{ color:'rgb(248,113,113)', flexShrink:0 }} />
                      }
                      <span style={ms(S.text4, { fontVariantNumeric:'tabular-nums', width:72, flexShrink:0 })}>{new Date(r.ts).toLocaleTimeString()}</span>
                      <span style={{ fontWeight:900, fontVariantNumeric:'tabular-nums', width:28, flexShrink:0, color: ok ? 'rgb(52,211,153)' : r.status ? 'rgb(251,191,36)' : 'rgb(248,113,113)' }}>
                        {r.status ?? 'ERR'}
                      </span>
                      {r.time !== null && <span style={S.text3}>{r.time}ms</span>}
                      {r.size !== null && <span style={ms(S.text5, { marginLeft:'auto' })}>{r.size}B</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FOOTER ═══════════════════════════════════════════════════ */}
      <div style={ms(S.footerBg, { height:32, borderTop:'1px solid var(--mon-border)', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', flexShrink:0 })}>
        <div style={{ display:'flex', alignItems:'center', gap:20, fontSize:8.5 }}>
          {[
            ['Uplink', socket.id?.slice(0,14).toUpperCase() || 'OFFLINE'],
            ['Buffer', `${logs.length}/${LOG_LIMIT}`],
            ['Interval', `${PING_INTERVAL/1000}s`],
          ].map(([label, val]) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:'var(--mon-border)' }} />
              <span style={S.text4}>{label}</span>
              <span style={ms(S.text2, { fontWeight:700, fontVariantNumeric:'tabular-nums' })}>{val}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Zap size={9} style={{ color:'var(--mon-teal)', opacity:0.5 }} />
          <span style={ms(S.text4, { fontSize:8.5, letterSpacing:'0.12em' })}>
            Designed &amp; developed with{' '}
            <span style={{ color:'var(--mon-teal)', fontWeight:700 }}>Shubham Kumar</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default LogMonitorPage;

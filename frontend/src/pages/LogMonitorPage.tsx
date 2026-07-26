import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal, Shield, Zap, Wifi, CheckCircle2, XCircle, AlertCircle,
  Activity, Radio, RefreshCw, Clock, Database, Server, Filter
} from 'lucide-react';
import { AreaChart, Area, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { socket } from '../utils/socket';
import type { LogEntry } from '../types';
import { getLogsForDate, saveSingleLogFromServer } from '../utils/logger';

// ── types ──────────────────────────────────────────────────────────────────
interface ApiCheck { ts: number; status: number | null; time: number | null; size: number | null; }

// ── constants ──────────────────────────────────────────────────────────────
const PING_LIMIT   = 40;
const API_LIMIT    = 30;
const LOG_LIMIT    = 200;
const PING_INTERVAL = 3000;
const API_INTERVAL  = 5000;

// ── helpers ────────────────────────────────────────────────────────────────
const avg   = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
const safeN = (arr: number[]) => arr.filter(v => v >= 0);

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

// ── tiny chart tooltip ─────────────────────────────────────────────────────
const ChartTip = ({ active, payload }: any) => {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="bg-[#0c1220] border border-white/10 rounded px-2 py-1 text-[9px] font-bold text-white/80">
      {payload[0].value}ms
    </div>
  );
};

// ── Status pill ────────────────────────────────────────────────────────────
const Pill: React.FC<{ ok: boolean | null; labelOk: string; labelFail: string; labelWait?: string }> =
  ({ ok, labelOk, labelFail, labelWait = 'WAITING' }) => {
    if (ok === null) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-bold text-white/30">
        <span className="w-1.5 h-1.5 rounded-full bg-white/20" />{labelWait}
      </span>
    );
    return ok ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-400">
        <CheckCircle2 size={9} />{labelOk}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-[9px] font-bold text-red-400">
        <XCircle size={9} />{labelFail}
      </span>
    );
  };

// ── StatCard ───────────────────────────────────────────────────────────────
const StatCard: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent = 'text-white' }) => (
  <div className="flex flex-col items-center justify-center bg-white/[0.03] rounded-lg border border-white/[0.07] py-2 px-1 gap-0.5">
    <span className="text-[8px] text-white/30 uppercase tracking-[0.18em] leading-none">{label}</span>
    <span className={`text-[13px] font-black tabular-nums leading-tight ${accent}`}>{value}</span>
  </div>
);

// ── MiniChart ──────────────────────────────────────────────────────────────
const MiniChart: React.FC<{
  samples: number[];
  color: string;
  gradId: string;
  empty?: React.ReactNode;
}> = ({ samples, color, gradId, empty }) => (
  <div className="flex-1 min-h-0 relative bg-black/25 rounded-xl border border-white/[0.06] overflow-hidden">
    {(!samples.length || samples.every(v => v < 0)) && empty && (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">{empty}</div>
    )}
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={samples.map(v => ({ v: v < 0 ? null : v }))} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="rgba(255,255,255,0.04)" />
        <YAxis hide domain={[0, 'auto']} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
const LogMonitorPage: React.FC = () => {
  const topOffset   = useTopOffset();
  const scrollRef   = useRef<HTMLDivElement>(null);
  const runPingRef  = useRef<() => void>(() => {});
  const runApiRef   = useRef<() => void>(() => {});

  const today = () => new Date().toISOString().split('T')[0];

  const [monitoredDate,   setMonitoredDate]   = useState(today);
  const [logs,            setLogs]            = useState<LogEntry[]>(() => getLogsForDate(today()));
  const [showNavLogs,     setShowNavLogs]     = useState(true);
  const [filterType,      setFilterType]      = useState<'all' | 'positive' | 'negative' | 'neutral'>('all');

  // Ping state
  const [pingSamples,  setPingSamples]  = useState<number[]>([]);
  const [lastPing,     setLastPing]     = useState<number | null>(null);

  // API state — using VITE_BACKEND_URL correctly (plain-text /health endpoint)
  const backendBase = import.meta.env.VITE_BACKEND_URL
    ? import.meta.env.VITE_BACKEND_URL.replace(/\/$/, '')
    : `${window.location.origin}`;
  const [apiUrl,         setApiUrl]         = useState(`${backendBase}/health`);
  const [apiSamples,     setApiSamples]     = useState<number[]>([]);
  const [lastApiStatus,  setLastApiStatus]  = useState<number | null>(null);
  const [lastApiSize,    setLastApiSize]    = useState<number | null>(null);
  const [recentChecks,   setRecentChecks]   = useState<ApiCheck[]>([]);
  const [apiChecking,    setApiChecking]    = useState(false);
  const [pingChecking,   setPingChecking]   = useState(false);

  // ── socket / logs ──────────────────────────────────────────────────────
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

  // ── Ping ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setPingChecking(true);
      const start = performance.now();
      try {
        await fetch(`${window.location.origin}/?__ping=${Date.now()}`, { cache: 'no-store' });
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
    runPingRef.current = run;
    run();
    const id = setInterval(run, PING_INTERVAL);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ── API Health check — correctly handles plain-text "Backend is running" ──
  const runApi = useCallback(async () => {
    if (!apiUrl) return;
    setApiChecking(true);
    const start = performance.now();
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' });
      const time = Math.max(0, Math.round(performance.now() - start));
      let size: number | null = null;
      let body = '';
      try { body = await res.text(); size = new Blob([body]).size; } catch {}

      // Health endpoint returns plain text "Backend is running" — that's a success
      // Only flag as failure if non-2xx
      const isHtml = (res.headers.get('content-type') || '').includes('text/html') && /<html/i.test(body);
      const success = res.ok && !isHtml;

      setLastApiStatus(res.status);
      setLastApiSize(size);
      if (success) {
        setApiSamples(p => [...p, time].slice(-API_LIMIT));
        setRecentChecks(p => [{ ts: Date.now(), status: res.status, time, size }, ...p].slice(0, 15));
      } else {
        setApiSamples(p => [...p, -1].slice(-API_LIMIT));
        setRecentChecks(p => [{ ts: Date.now(), status: res.status, time: null, size }, ...p].slice(0, 15));
      }
    } catch {
      setLastApiStatus(null); setLastApiSize(null);
      setApiSamples(p => [...p, -1].slice(-API_LIMIT));
      setRecentChecks(p => [{ ts: Date.now(), status: null, time: null, size: null }, ...p].slice(0, 15));
    } finally { setApiChecking(false); }
  }, [apiUrl]);

  useEffect(() => {
    runApiRef.current = runApi;
    runApi();
    const id = setInterval(runApi, API_INTERVAL);
    return () => clearInterval(id);
  }, [runApi]);

  // ── Derived ───────────────────────────────────────────────────────────
  const lastApiSample = apiSamples.at(-1) ?? null;
  const apiOnline     = lastApiSample !== null && lastApiSample >= 0;
  const apiHasData    = apiSamples.length > 0;
  const goodN         = safeN(pingSamples);
  const pingLoss      = pingSamples.length ? Math.round((pingSamples.filter(v => v < 0).length / pingSamples.length) * 100) : null;
  const jitterVal     = goodN.length < 2 ? null : Math.round(safeN(goodN.slice(1).map((v, i) => Math.abs(v - goodN[i]))).reduce((a, b) => a + b, 0) / (goodN.length - 1));

  const visibleLogs = logs
    .filter(l => showNavLogs || (!/navigate/i.test(l.action) && !/visited/i.test(l.details)))
    .filter(l => filterType === 'all' || l.type === filterType);

  const connectedAt = socket.connected ? new Date().toLocaleTimeString() : '—';

  return (
    <div
      className="fixed left-0 right-0 bottom-0 flex flex-col overflow-hidden select-none"
      style={{
        top: `${topOffset}px`,
        background: 'linear-gradient(160deg, #0b0f1e 0%, #0d1228 60%, #0a0e1a 100%)',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      }}
    >
      {/* ═══ TOPBAR ═══════════════════════════════════════════════════════ */}
      <div className="shrink-0 h-11 border-b border-white/[0.08] flex items-center justify-between px-5 bg-white/[0.02]">
        {/* Left */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#00ADB5]/20 border border-[#00ADB5]/40 flex items-center justify-center shadow-[0_0_12px_rgba(0,173,181,0.2)]">
              <Terminal size={13} className="text-[#00ADB5]" />
            </div>
            <div className="leading-none">
              <p className="text-[9px] text-white/30 tracking-[0.25em] uppercase">Queue Tracker</p>
              <p className="text-[11px] font-black text-white tracking-widest uppercase">System Monitor</p>
            </div>
          </div>

          <div className="w-px h-6 bg-white/10" />

          {/* Live pulse */}
          <div className="flex items-center gap-1.5">
            <div className="relative w-2 h-2">
              <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40" />
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
            <span className="text-[9px] font-bold text-emerald-400 tracking-[0.2em] uppercase">Live</span>
          </div>

          {/* Socket */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold tracking-wider ${
            socket.connected
              ? 'bg-[#00ADB5]/10 border-[#00ADB5]/25 text-[#00ADB5]'
              : 'bg-red-500/10 border-red-500/25 text-red-400'
          }`}>
            <Radio size={9} className={socket.connected ? '' : 'animate-pulse'} />
            {socket.connected ? `SOCKET · ${socket.id?.slice(0, 6).toUpperCase()}` : 'SOCKET LOST'}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2.5">
          {/* Date picker */}
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 h-7">
            <Clock size={10} className="text-white/30" />
            <input
              type="date" value={monitoredDate}
              onChange={e => setMonitoredDate(e.target.value)}
              className="bg-transparent text-[10px] text-white/70 outline-none cursor-pointer w-28"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-1 h-7">
            <Filter size={9} className="text-white/30 ml-1" />
            {(['all', 'positive', 'negative', 'neutral'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-2 h-5 rounded text-[8px] font-bold uppercase tracking-wider transition-all ${
                  filterType === t
                    ? t === 'positive' ? 'bg-emerald-500/20 text-emerald-400'
                    : t === 'negative' ? 'bg-red-500/20 text-red-400'
                    : t === 'neutral'  ? 'bg-white/10 text-white/60'
                    : 'bg-white/10 text-white/70'
                    : 'text-white/25 hover:text-white/50'
                }`}>
                {t === 'all' ? 'All' : t === 'positive' ? '✓' : t === 'negative' ? '✗' : '○'}
              </button>
            ))}
          </div>

          {/* Nav toggle */}
          <button onClick={() => setShowNavLogs(s => !s)}
            className={`px-3 h-7 rounded-lg border text-[9px] font-bold tracking-wider transition-all ${
              showNavLogs ? 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/70'
                         : 'bg-[#00ADB5]/10 border-[#00ADB5]/25 text-[#00ADB5]'
            }`}>
            {showNavLogs ? 'Hide Nav' : 'Nav Hidden'}
          </button>
        </div>
      </div>

      {/* ═══ BODY ═════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── LEFT: Event Log (58%) ──────────────────────────────────────── */}
        <div className="flex flex-col border-r border-white/[0.07]" style={{ width: '58%' }}>

          {/* Sub-header */}
          <div className="shrink-0 h-8 border-b border-white/[0.06] flex items-center justify-between px-4 bg-white/[0.015]">
            <div className="flex items-center gap-2">
              <Database size={10} className="text-white/30" />
              <span className="text-[9px] font-bold text-white/35 tracking-[0.2em] uppercase">Event Stream</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[8px] text-white/20 tabular-nums">{visibleLogs.length} events</span>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" title="Positive" />
                <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" title="Negative" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/20" title="Neutral" />
              </div>
            </div>
          </div>

          {/* Entries */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-1 custom-scrollbar-dark">
            {visibleLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Shield size={36} strokeWidth={1} className="text-white/10" />
                <p className="text-[9px] font-bold uppercase tracking-[0.4em] text-white/15 animate-pulse">No Events</p>
              </div>
            ) : visibleLogs.map((log, i) => {
              const pos = log.type === 'positive';
              const neg = log.type === 'negative';
              return (
                <div key={i} className={`
                  flex items-center gap-0 text-[10px] mx-2 my-[1px] rounded-md px-2 py-[3px]
                  hover:bg-white/[0.03] transition-colors cursor-default
                  border-l-2 ${pos ? 'border-emerald-400/50' : neg ? 'border-red-400/50' : 'border-white/[0.08]'}
                `}>
                  <span className="text-white/20 shrink-0 w-[76px] tabular-nums text-[8.5px]">{log.timestamp}</span>
                  <span className="text-[#00ADB5]/60 shrink-0 font-bold w-[88px] truncate text-[8.5px]">{log.user}</span>
                  <span className={`shrink-0 font-black uppercase text-[8.5px] w-[108px] truncate ${
                    pos ? 'text-emerald-400' : neg ? 'text-red-400' : 'text-white/40'
                  }`}>{log.action}</span>
                  <span className={`flex-1 truncate text-[9.5px] ${
                    pos ? 'text-emerald-300/70' : neg ? 'text-red-300/70' : 'text-white/50'
                  }`}>{log.details}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Diagnostics (42%) ───────────────────────────────────── */}
        <div className="flex flex-col" style={{ width: '42%' }}>

          {/* ┌─ PING PANEL ─────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col border-b border-white/[0.07] p-3 gap-2">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#00ADB5]/15 border border-[#00ADB5]/25 flex items-center justify-center">
                  <Wifi size={11} className="text-[#00ADB5]" />
                </div>
                <div className="leading-none">
                  <p className="text-[11px] font-black text-white/90">Network Latency</p>
                  <p className="text-[8px] text-white/25 tracking-widest">Frontend round-trip ping</p>
                </div>
                {pingLoss !== null && pingLoss > 10 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[8px] text-amber-400 font-bold">
                    <AlertCircle size={8} />{pingLoss}% LOSS
                  </span>
                )}
              </div>
              <button onClick={() => runPingRef.current()}
                disabled={pingChecking}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-[9px] text-white/50 hover:text-white/80 transition-all disabled:opacity-40">
                <RefreshCw size={9} className={pingChecking ? 'animate-spin' : ''} />Ping
              </button>
            </div>

            {/* Stats grid */}
            <div className="shrink-0 grid grid-cols-6 gap-1.5">
              <StatCard label="Last"   value={lastPing !== null ? `${lastPing}ms` : '—'} accent={lastPing !== null && lastPing > 200 ? 'text-amber-400' : 'text-white'} />
              <StatCard label="Avg"    value={avg(goodN) !== null ? `${avg(goodN)}ms` : '—'} />
              <StatCard label="Min"    value={goodN.length ? `${Math.min(...goodN)}ms` : '—'} accent="text-emerald-400" />
              <StatCard label="Max"    value={goodN.length ? `${Math.max(...goodN)}ms` : '—'} accent="text-red-400" />
              <StatCard label="Loss"   value={pingLoss !== null ? `${pingLoss}%` : '—'} accent={pingLoss !== null && pingLoss > 5 ? 'text-amber-400' : 'text-white'} />
              <StatCard label="Jitter" value={jitterVal !== null ? `${jitterVal}ms` : '—'} />
            </div>

            {/* Chart */}
            <MiniChart
              samples={pingSamples} color="#00ADB5" gradId="pingG"
              empty={<span className="text-[9px] text-white/15 uppercase tracking-widest">Sampling…</span>}
            />

            <div className="shrink-0 flex justify-between text-[8px] text-white/15">
              <span>Failures: {pingSamples.filter(v => v < 0).length}</span>
              <span>Samples: {pingSamples.length} / {PING_LIMIT}</span>
            </div>
          </div>

          {/* ┌─ API HEALTH PANEL ───────────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-md border flex items-center justify-center ${
                  !apiHasData ? 'bg-white/5 border-white/10'
                  : apiOnline  ? 'bg-emerald-500/15 border-emerald-500/30'
                               : 'bg-red-500/15 border-red-500/30'
                }`}>
                  <Server size={11} className={!apiHasData ? 'text-white/30' : apiOnline ? 'text-emerald-400' : 'text-red-400'} />
                </div>
                <div className="leading-none">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-black text-white/90">API Health</p>
                    <Pill ok={!apiHasData ? null : apiOnline} labelOk="ONLINE" labelFail="OFFLINE" />
                  </div>
                  <p className="text-[8px] text-white/25 tracking-widest">Backend /health endpoint</p>
                </div>
              </div>
              <button onClick={runApi} disabled={apiChecking}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-[9px] text-white/50 hover:text-white/80 transition-all disabled:opacity-40">
                <RefreshCw size={9} className={apiChecking ? 'animate-spin' : ''} />Check
              </button>
            </div>

            {/* URL input */}
            <div className="shrink-0 flex items-center gap-1.5 bg-black/20 border border-white/[0.07] rounded-lg px-2 h-7">
              <Activity size={9} className="text-white/20 shrink-0" />
              <input
                value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                className="flex-1 bg-transparent text-[9px] text-white/60 outline-none placeholder-white/15"
                placeholder="https://your-backend/health"
              />
            </div>

            {/* Stats grid */}
            <div className="shrink-0 grid grid-cols-3 gap-1.5">
              <StatCard
                label="HTTP Status"
                value={!apiHasData ? '—' : lastApiStatus === null ? 'No resp' : String(lastApiStatus)}
                accent={apiHasData && lastApiStatus !== null && lastApiStatus >= 200 && lastApiStatus < 300 ? 'text-emerald-400' : apiHasData ? 'text-red-400' : 'text-white'}
              />
              <StatCard
                label="Last RTT"
                value={!apiHasData ? '—' : lastApiSample !== null && lastApiSample >= 0 ? `${lastApiSample}ms` : 'Timeout'}
              />
              <StatCard
                label="Payload"
                value={lastApiSize !== null ? `${lastApiSize}B` : '—'}
              />
            </div>

            {/* Chart */}
            <MiniChart
              samples={apiSamples} color={apiOnline ? '#10b981' : '#ef4444'} gradId="apiG"
              empty={<span className="text-[9px] text-white/15 uppercase tracking-widest">Awaiting first check…</span>}
            />

            {/* Recent checks table */}
            <div className="shrink-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] text-white/20 uppercase tracking-[0.2em]">Recent Checks</p>
                <p className="text-[8px] text-white/15 tabular-nums">{recentChecks.length} logged</p>
              </div>
              <div className="space-y-[2px]">
                {recentChecks.length === 0 ? (
                  <p className="text-[8px] text-white/15 italic">No checks yet…</p>
                ) : recentChecks.slice(0, 6).map((r, i) => {
                  const ok = r.status !== null && r.status >= 200 && r.status < 300;
                  return (
                    <div key={i} className={`flex items-center gap-2 px-2 py-[2px] rounded text-[8.5px] ${
                      ok ? 'bg-emerald-500/5' : 'bg-red-500/5'
                    }`}>
                      {ok
                        ? <CheckCircle2 size={9} className="text-emerald-400 shrink-0" />
                        : r.status ? <AlertCircle size={9} className="text-amber-400 shrink-0" />
                        : <XCircle size={9} className="text-red-400 shrink-0" />
                      }
                      <span className="text-white/20 tabular-nums w-[72px] shrink-0">{new Date(r.ts).toLocaleTimeString()}</span>
                      <span className={`font-black tabular-nums w-8 shrink-0 ${ok ? 'text-emerald-400' : r.status ? 'text-amber-400' : 'text-red-400'}`}>
                        {r.status ?? 'ERR'}
                      </span>
                      {r.time !== null && <span className="text-white/30 tabular-nums">{r.time}ms</span>}
                      {r.size !== null && <span className="text-white/15 tabular-nums ml-auto">{r.size}B</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FOOTER ═══════════════════════════════════════════════════════ */}
      <div className="shrink-0 h-8 border-t border-white/[0.06] bg-black/20 flex items-center justify-between px-5">
        <div className="flex items-center gap-5 text-[8.5px]">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <span className="text-white/20 uppercase tracking-widest">Uplink</span>
            <span className="text-white/50 font-bold tabular-nums">{socket.id?.slice(0, 14).toUpperCase() || 'OFFLINE'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <span className="text-white/20 uppercase tracking-widest">Buffer</span>
            <span className="text-white/50 font-bold tabular-nums">{logs.length}/{LOG_LIMIT}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <span className="text-white/20 uppercase tracking-widest">Ping every</span>
            <span className="text-white/50 font-bold">{PING_INTERVAL / 1000}s</span>
          </div>
        </div>

        {/* Credit */}
        <div className="flex items-center gap-2">
          <Zap size={8} className="text-[#00ADB5]/50" />
          <span className="text-[8.5px] text-white/25 tracking-widest">
            Designed &amp; developed with{' '}
            <span className="text-[#00ADB5]/70 font-bold">Shubham Kumar</span>
          </span>
        </div>
      </div>

      <style>{`
        .custom-scrollbar-dark::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar-dark::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      `}</style>
    </div>
  );
};

export default LogMonitorPage;

import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Shield, Zap, Wifi, CheckCircle2, XCircle, AlertCircle, Activity } from 'lucide-react';
import { AreaChart, Area, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { socket } from '../utils/socket';
import type { LogEntry } from '../types';
import { getLogsForDate, saveSingleLogFromServer } from '../utils/logger';

const LogMonitorPage: React.FC = () => {
  const [monitoredDate, setMonitoredDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogsForDate(new Date().toISOString().split('T')[0]));
  const [topOffset, setTopOffset] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pingSamples, setPingSamples] = useState<number[]>([]);
  const [lastPing, setLastPing] = useState<number | null>(null);
  const lastSuccessRef = useRef<number | null>(null);
  const defaultApiUrl = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL.replace(/\/$/, '')}/health` : `${window.location.origin}/api/health`;
  const [apiUrl, setApiUrl] = useState<string>(defaultApiUrl);
  const [apiSamples, setApiSamples] = useState<number[]>([]);
  const [showNavLogs, setShowNavLogs] = useState<boolean>(true);
  const [lastApiStatus, setLastApiStatus] = useState<number | null>(null);
  const [lastApiSize, setLastApiSize] = useState<number | null>(null);
  const apiLimit = 20;
  const runApiRef = useRef<() => void>(() => {});
  const recentApiRef = useRef<Array<{ts:number; status:number|null; time:number|null; size:number|null}>>([]);
  const pingLimit = 30;
  const runPingRef = useRef<() => void>(() => {});

  // Update top offset based on navbar height
  useEffect(() => {
    const updateTop = () => {
      const nav = document.querySelector('nav');
      const header = document.querySelector('header');
      const el = nav || header;
      if (el) {
        setTopOffset(Math.ceil((el as HTMLElement).getBoundingClientRect().bottom));
      } else {
        setTopOffset(0);
      }
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    const obs = new MutationObserver(updateTop);
    obs.observe(document.body, { attributes: true, childList: true, subtree: true });
    return () => {
      window.removeEventListener('resize', updateTop);
      obs.disconnect();
    };
  }, []);

  // Socket logs
  useEffect(() => {
    const handleNewLog = ({ dateStr, logEntry }: { dateStr: string; logEntry: LogEntry }) => {
      // Save into localstore for that date
      try {
        saveSingleLogFromServer(dateStr, logEntry);
      } catch (_e) {}

      // If we're currently viewing that date, append
      if (dateStr === monitoredDate) {
        setLogs(prev => [...prev, logEntry].slice(-100));
      }
    };
    socket.on('log_added', handleNewLog);
    return () => void socket.off('log_added', handleNewLog);
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  // Reload logs when monitoredDate changes
  useEffect(() => {
    setLogs(getLogsForDate(monitoredDate));
  }, [monitoredDate]);

  // Ping sampler
  useEffect(() => {
    let mounted = true;
    const runPing = async () => {
      const url = `${window.location.origin}/?__ping=${Date.now()}`;
      const start = performance.now();
      try {
        await fetch(url, { cache: 'no-store' });
        const rtt = Math.max(0, Math.round(performance.now() - start));
        if (!mounted) return;
        setLastPing(rtt);
        lastSuccessRef.current = Date.now();
        setPingSamples(prev => [...prev, rtt].slice(-pingLimit));
      } catch (_err) {
        if (!mounted) return;
        setLastPing(null);
        setPingSamples(prev => [...prev, -1].slice(-pingLimit));
      }
    };
    runPingRef.current = runPing;
    runPing();
    const id = setInterval(runPing, 3000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // API checks
  useEffect(() => {
    let mounted = true;
    const runApi = async () => {
      if (!apiUrl) return;
      const start = performance.now();
      try {
        const res = await fetch(apiUrl, { cache: 'no-store' });
        const time = Math.max(0, Math.round(performance.now() - start));
        let size = null;
        let bodyText = '';
        try {
          bodyText = await res.text();
          size = new Blob([bodyText]).size;
        } catch (_e) {
          size = null;
        }

        // If server returns HTML (likely index.html from frontend) treat as failure
        const contentType = res.headers.get('content-type') || '';
        const looksLikeHtml = contentType.includes('text/html') || /<html/i.test(bodyText);

        if (!mounted) return;

        if (!res.ok || looksLikeHtml) {
          // failure (non-2xx or HTML payload)
          setLastApiStatus(res.status);
          setLastApiSize(size);
          setApiSamples(prev => [...prev, -1].slice(-apiLimit));
          recentApiRef.current = [{ ts: Date.now(), status: res.status, time: null, size }, ...recentApiRef.current].slice(0, 12);
        } else {
          // success
          setLastApiStatus(res.status);
          setLastApiSize(size);
          setApiSamples(prev => [...prev, time].slice(-apiLimit));
          recentApiRef.current = [{ ts: Date.now(), status: res.status, time, size }, ...recentApiRef.current].slice(0, 12);
        }
      } catch (_err) {
        if (!mounted) return;
        setLastApiStatus(null);
        setLastApiSize(null);
        setApiSamples(prev => [...prev, -1].slice(-apiLimit));
        recentApiRef.current = [{ ts: Date.now(), status: null, time: null, size: null }, ...recentApiRef.current].slice(0, 12);
      }
    };
    runApiRef.current = runApi;
    runApi();
    const id = setInterval(runApi, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [apiUrl]);

  // Derived API status helpers
  const lastApiSample = apiSamples.length ? apiSamples[apiSamples.length - 1] : null;
  const apiIsOnline = lastApiSample !== null && lastApiSample >= 0;
  const apiHasData = apiSamples.length > 0;
  const pingLoss = pingSamples.length
    ? Math.round((pingSamples.filter(n => n < 0).length / pingSamples.length) * 100)
    : null;

  return (
    <div
      className="fixed left-0 right-0 bottom-0 bg-[#0a0e27] text-white font-mono flex flex-col overflow-hidden select-none"
      style={{ top: `${topOffset}px` }}
    >
      {/* ── Top Status Bar ── */}
      <div className="bg-white text-[#0a0e27] px-5 py-2.5 flex justify-between items-center shrink-0 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <Terminal size={15} className="animate-pulse text-[#0a0e27]" />
          <h1 className="text-[10px] font-black uppercase tracking-[0.3em]">System Event Monitor v4.0</h1>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest">
          {/* Socket status */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${socket.connected ? 'bg-emerald-50' : 'bg-red-50'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${socket.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
            <span className={socket.connected ? 'text-emerald-700' : 'text-red-600'}>
              Link: {socket.connected ? 'OK' : 'LOST'}
            </span>
          </div>
          {/* Live badge */}
          <span className="px-2.5 py-1 border border-slate-300 rounded bg-white text-[#0a0e27] tracking-[0.2em] text-[8px]">LIVE</span>
          {/* Date picker */}
          <div className="flex items-center gap-2">
            <label className="text-[9px] text-slate-400 uppercase tracking-widest">Logs Date</label>
            <input
              type="date"
              value={monitoredDate}
              onChange={(e) => setMonitoredDate(e.target.value)}
              className="bg-slate-50 px-2 py-1 text-[10px] rounded border border-slate-300 text-[#0a0e27]"
              style={{ WebkitTextFillColor: '#0a0e27', color: '#0a0e27' }}
            />
          </div>
          {/* Nav logs toggle — clean pill */}
          <button
            onClick={() => setShowNavLogs(s => !s)}
            title="Toggle navigation log entries"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-wider transition-colors ${
              showNavLogs
                ? 'bg-slate-100 border-slate-300 text-slate-600'
                : 'bg-[#0a0e27] border-[#0a0e27] text-white'
            }`}
          >
            {showNavLogs ? 'Hide Nav Logs' : 'Nav Logs Hidden'}
          </button>
        </div>
      </div>

      {/* ── Main: logs left, diagnostics right ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Logs */}
        <div
          ref={scrollRef}
          className="w-1/2 overflow-y-auto p-5 space-y-1 custom-scrollbar-dark text-[11px] bg-[#0a0e27]"
        >
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
              <Shield size={48} strokeWidth={1} />
              <p className="text-xs font-black uppercase tracking-[0.5em] animate-pulse">Awaiting Data...</p>
            </div>
          ) : (
            (() => {
              const visibleLogs = showNavLogs
                ? logs
                : logs.filter(l => !/navigate/i.test(l.action) && !/visited/i.test(l.details));
              return visibleLogs.map((log, i) => (
                <div key={i} className="flex gap-3 px-1 py-0.5 group hover:bg-white/[0.03] rounded">
                  <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                  <span className="text-slate-300 shrink-0 font-bold">[{log.user}]</span>
                  <span className={`shrink-0 font-black uppercase tracking-wider ${
                    log.type === 'positive' ? 'text-emerald-400' :
                    log.type === 'negative' ? 'text-red-400' :
                    'text-slate-300'
                  }`}>{log.action}:</span>
                  <span className={`break-all font-medium ${
                    log.type === 'positive' ? 'text-emerald-300' :
                    log.type === 'negative' ? 'text-red-300' :
                    'text-white/80'
                  }`}>{log.details}</span>
                </div>
              ));
            })()
          )}
        </div>

        {/* Right: Ping + API */}
        <div className="w-1/2 flex flex-col border-l border-slate-700/60 bg-[#0d1230]">

          {/* ── PING PANEL ── */}
          <div className="flex flex-col gap-3 p-4 border-b border-slate-700/60" style={{ flex: '1 1 0' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Wifi size={15} className="text-[#00ADB5]" />
                <div className="leading-tight">
                  <h3 className="text-[13px] font-semibold text-white">Ping</h3>
                  <p className="text-[10px] text-slate-500">Realtime network round-trip time</p>
                </div>
                {pingLoss !== null && pingLoss > 10 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[9px] text-amber-400 font-bold">
                    <AlertCircle size={9} /> {pingLoss}% LOSS
                  </span>
                )}
              </div>
              <button
                onClick={() => runPingRef.current()}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] text-slate-300 transition-colors"
              >
                Ping Now
              </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 grid-rows-2 gap-x-4 gap-y-1.5">
              {[
                { label: 'Last', value: lastPing !== null ? `${lastPing} ms` : '—' },
                { label: 'Avg', value: (() => { const n = pingSamples.filter(v => v >= 0); return n.length ? `${Math.round(n.reduce((a,b) => a+b,0)/n.length)} ms` : '—'; })() },
                { label: 'Min', value: (() => { const n = pingSamples.filter(v => v >= 0); return n.length ? `${Math.min(...n)} ms` : '—'; })() },
                { label: 'Max', value: (() => { const n = pingSamples.filter(v => v >= 0); return n.length ? `${Math.max(...n)} ms` : '—'; })() },
                { label: 'Loss', value: pingLoss !== null ? `${pingLoss}%` : '—' },
                { label: 'Jitter', value: (() => { const n = pingSamples.filter(v => v >= 0); if (n.length < 2) return '—'; const d = n.slice(1).map((v,i) => Math.abs(v - n[i])); return `${Math.round(d.reduce((a,b) => a+b,0)/d.length)} ms`; })() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-0.5">
                  <span className="text-[10px] text-slate-500 uppercase">{label}</span>
                  <span className="text-[12px] font-semibold text-white tabular-nums">{value}</span>
                </div>
              ))}
            </div>

            {/* Ping chart — dark background */}
            <div className="flex-1 min-h-0 bg-[#0a0e27] rounded border border-slate-700/50 flex relative p-2">
              <div className="w-10 flex flex-col justify-between text-right py-1 pr-1 shrink-0">
                {[...Array(4)].map((_, i) => {
                  const maxVal = Math.max(1, ...pingSamples.filter(n => n >= 0), 100);
                  const label = i === 0 ? maxVal : i === 1 ? Math.round(maxVal * 0.66) : i === 2 ? Math.round(maxVal * 0.33) : 0;
                  return (
                    <span key={i} className="text-[9px] text-slate-600 font-semibold h-0 flex items-end justify-end leading-none">
                      {label}
                    </span>
                  );
                })}
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pingSamples.map(val => ({ value: val < 0 ? null : val }))} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <defs>
                      <linearGradient id="pingGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00ADB5" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#00ADB5" stopOpacity="0.03" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#1e2a4a" />
                    <YAxis hide={true} />
                    <Area type="monotone" dataKey="value" stroke="#00ADB5" strokeWidth={1.5} fill="url(#pingGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex justify-between text-[10px] text-slate-600">
              <span>Failures: {pingSamples.filter(n => n < 0).length}</span>
              <span>Samples: {pingSamples.length}</span>
            </div>
          </div>

          {/* ── API PANEL ── */}
          <div className="flex flex-col gap-3 p-4" style={{ flex: '1 1 0' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Activity size={15} className={apiIsOnline ? 'text-emerald-400' : apiHasData ? 'text-red-400' : 'text-slate-500'} />
                <div className="leading-tight">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-white">API Checks</h3>
                    {/* Status badge — the key visual improvement */}
                    {!apiHasData ? null : apiIsOnline ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[9px] text-emerald-400 font-bold">
                        <CheckCircle2 size={9} /> ONLINE
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-[9px] text-red-400 font-bold">
                        <XCircle size={9} /> OFFLINE
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500">Health endpoint monitoring</p>
                </div>
              </div>
              <div className="flex gap-1.5 items-center">
                <input
                  value={apiUrl}
                  onChange={e => setApiUrl(e.target.value)}
                  className="bg-white/5 px-2 py-1 text-[10px] rounded w-44 border border-slate-700/60 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  placeholder="Health URL"
                />
                <button
                  onClick={() => runApiRef.current()}
                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] text-slate-300 transition-colors"
                >
                  Check
                </button>
              </div>
            </div>

            {/* Stats: show clean values, never raw ERR */}
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
              {[
                {
                  label: 'Status',
                  value: !apiHasData ? '—'
                    : lastApiStatus === null ? 'No response'
                    : String(lastApiStatus),
                  highlight: apiHasData && lastApiStatus !== null && lastApiStatus >= 200 && lastApiStatus < 300
                    ? 'ok' : apiHasData ? 'err' : 'none',
                },
                {
                  label: 'Last RTT',
                  value: !apiHasData ? '—'
                    : lastApiSample !== null && lastApiSample >= 0 ? `${lastApiSample} ms`
                    : 'Timed out',
                  highlight: 'none',
                },
                {
                  label: 'Size',
                  value: lastApiSize !== null ? `${lastApiSize} B` : '—',
                  highlight: 'none',
                },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex items-center justify-between py-0.5">
                  <span className="text-[10px] text-slate-500 uppercase">{label}</span>
                  <span className={`text-[12px] font-semibold tabular-nums ${
                    highlight === 'ok' ? 'text-emerald-400' :
                    highlight === 'err' ? 'text-red-400' :
                    'text-white'
                  }`}>{value}</span>
                </div>
              ))}
            </div>

            {/* API chart — dark background, red stroke when failing */}
            <div className="flex-1 min-h-0 bg-[#0a0e27] rounded border border-slate-700/50 flex relative p-2">
              {!apiHasData && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] text-slate-600 uppercase tracking-widest">Awaiting first check…</span>
                </div>
              )}
              {apiHasData && !apiIsOnline && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="flex items-center gap-1.5 text-[10px] text-red-400/60 uppercase tracking-widest">
                    <XCircle size={12} /> Backend unreachable
                  </span>
                </div>
              )}
              <div className="w-10 flex flex-col justify-between text-right py-1 pr-1 shrink-0">
                {[...Array(3)].map((_, i) => {
                  const maxVal = Math.max(1, ...apiSamples.filter(n => n >= 0), 200);
                  const label = i === 0 ? maxVal : i === 1 ? Math.round(maxVal * 0.5) : 0;
                  return (
                    <span key={i} className="text-[9px] text-slate-600 font-semibold h-0 flex items-end justify-end leading-none">
                      {label}
                    </span>
                  );
                })}
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={apiSamples.map(val => ({ value: val < 0 ? null : val }))} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <defs>
                      <linearGradient id="apiGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={apiIsOnline ? '#10b981' : '#ef4444'} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={apiIsOnline ? '#10b981' : '#ef4444'} stopOpacity="0.03" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#1e2a4a" />
                    <YAxis hide={true} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={apiIsOnline ? '#10b981' : '#ef4444'}
                      strokeWidth={1.5}
                      fill="url(#apiGrad)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent checks — pill-style, no raw ERR text */}
            <div className="shrink-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Recent Checks</p>
              <div className="space-y-1">
                {recentApiRef.current.length === 0 ? (
                  <p className="text-[10px] text-slate-600">No checks yet</p>
                ) : (
                  recentApiRef.current.slice(0, 4).map((r, idx) => {
                    const isOk = r.status !== null && r.status >= 200 && r.status < 300;
                    const isWarn = r.status !== null && !isOk;
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        {isOk
                          ? <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                          : isWarn
                          ? <AlertCircle size={10} className="text-amber-400 shrink-0" />
                          : <XCircle size={10} className="text-red-400 shrink-0" />
                        }
                        <span className="text-[10px] text-slate-500 tabular-nums">{new Date(r.ts).toLocaleTimeString()}</span>
                        <span className={`text-[10px] font-semibold tabular-nums ${isOk ? 'text-emerald-400' : isWarn ? 'text-amber-400' : 'text-red-400'}`}>
                          {r.status !== null ? r.status : 'No response'}
                        </span>
                        {r.time !== null && <span className="text-[10px] text-slate-600">{r.time}ms</span>}
                        {r.size ? <span className="text-[10px] text-slate-600">{r.size}B</span> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="bg-white text-[#0a0e27] border-t border-slate-200 px-5 py-2 flex justify-between items-center shrink-0">
        <div className="flex gap-5">
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-400 font-black uppercase tracking-widest">Uplink ID</p>
            <p className="text-[9px] font-black">{socket.id?.slice(0, 12).toUpperCase() || 'OFFLINE'}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-400 font-black uppercase tracking-widest">Buffer</p>
            <p className="text-[9px] font-black">{logs.length}/100</p>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-50">
          <Zap size={9} className="text-[#00ADB5]" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Classified Access Only</p>
        </div>
      </div>

      <style>{`
        .custom-scrollbar-dark::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar-dark::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb { background: #2d3a5e; border-radius: 0; }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover { background: #3d4e78; }
      `}</style>
    </div>
  );
};

export default LogMonitorPage;

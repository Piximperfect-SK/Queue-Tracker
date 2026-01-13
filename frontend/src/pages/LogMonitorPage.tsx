import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Shield, Zap, Wifi } from 'lucide-react';
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
  const [apiUrl, setApiUrl] = useState<string>(`${window.location.origin}/api/health`);
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

  return (
    <div 
      className="fixed left-0 right-0 bottom-0 bg-[#0a0e27] text-white font-mono flex flex-col overflow-hidden select-none"
      style={{ top: `${topOffset}px` }}
    >
      {/* Top Status Bar - WHITE HEADER */}
      <div className="bg-white text-[#0a0e27] px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <Terminal size={18} className="animate-pulse text-[#0a0e27]" />
          <h1 className="text-[10px] font-black uppercase tracking-[0.3em]">System Event Monitor v4.0</h1>
        </div>
        <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 rounded">
            <div className={`w-1.5 h-1.5 rounded-full ${socket.connected ? 'bg-[#00ADB5] animate-pulse' : 'bg-red-400'}`} />
            <span className="text-[#0a0e27]">Link: {socket.connected ? 'OK' : 'LOST'}</span>
          </div>
          <span className="px-3 py-1 border border-slate-300 rounded bg-white text-[#0a0e27] tracking-[0.2em] text-[8px]">LIVE</span>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-slate-500 uppercase tracking-widest">Logs Date</label>
            <input type="date" value={monitoredDate} onChange={(e) => setMonitoredDate(e.target.value)} className="bg-white/6 px-2 py-1 text-xs rounded border border-slate-700 text-white" />
            <button
              onClick={() => setShowNavLogs(s => !s)}
              className={`px-2 py-1 rounded border border-slate-300 text-[9px] font-black uppercase tracking-wider ${showNavLogs ? 'bg-white text-[#0a0e27]' : 'bg-transparent text-slate-500'}`}
              title="Toggle hiding of navigation logs"
            >
              Hide Navigation Logs
            </button>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${!showNavLogs ? 'bg-white text-[#0a0e27]' : 'bg-transparent text-slate-400'} `}>
              {!showNavLogs ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      </div>

      {/* Main area: left logs, right split (Ping + API) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Logs - SCROLLABLE */}
        <div 
          ref={scrollRef}
          className="w-1/2 overflow-y-auto p-6 space-y-1.5 custom-scrollbar-dark text-[11px] bg-[#0a0e27]"
        >
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
              <Shield size={48} strokeWidth={1} />
              <p className="text-xs font-black uppercase tracking-[0.5em] animate-pulse">Awaiting Data...</p>
            </div>
          ) : (
            // apply format filter: hide navigation logs when toggled off
            (() => {
              const visibleLogs = showNavLogs ? logs : logs.filter(l => !/navigate/i.test(l.action) && !/visited/i.test(l.details));
              return visibleLogs.map((log, i) => (
              <div key={i} className="flex gap-3 px-1 py-0.5 group">
                <span className="text-slate-400 shrink-0 select-none">[{log.timestamp}]</span>
                <span className="text-white shrink-0 font-black">[{log.user}]</span>
                <span className={`shrink-0 font-black uppercase tracking-wider ${
                  log.type === 'positive' ? 'text-green-400' : 
                  log.type === 'negative' ? 'text-red-400' : 
                  'text-white'
                }`}>{log.action}:</span>
                <span className={`break-all font-bold ${
                  log.type === 'positive' ? 'text-green-300' : 
                  log.type === 'negative' ? 'text-red-300' : 
                  'text-white/90'
                }`}>{log.details}</span>
              </div>
              ));
            })()
          )}
        </div>

        {/* Right: split into Ping (top) and API (bottom) - NO SCROLL */}
        <div className="w-1/2 flex flex-col border-l border-slate-700 p-4 bg-[#0f1535] gap-4 overflow-hidden">
          {/* Ping (card) */}
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi size={18} className="text-[#00ADB5]" />
                <div className="leading-tight">
                  <h3 className="text-lg font-semibold text-white">Ping</h3>
                  <p className="text-xs text-slate-400">Realtime network round-trip time</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => runPingRef.current()} className="px-3 py-1 bg-white/8 hover:bg-white/16 rounded text-xs text-white">Ping Now</button>
              </div>
            </div>

            <div className="grid grid-cols-3 grid-rows-2 gap-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Last</span>
                <span className="font-semibold text-white text-sm">{lastPing !== null ? `${lastPing} ms` : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Avg</span>
                <span className="font-semibold text-white text-sm">{(() => { const nums = pingSamples.filter(n => n >= 0); if (!nums.length) return '—'; return `${Math.round(nums.reduce((a,b) => a+b,0)/nums.length)} ms`; })()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Min</span>
                <span className="font-semibold text-white text-sm">{(() => { const nums = pingSamples.filter(n => n >= 0); return nums.length ? `${Math.min(...nums)} ms` : '—'; })()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Max</span>
                <span className="font-semibold text-white text-sm">{(() => { const nums = pingSamples.filter(n => n >= 0); return nums.length ? `${Math.max(...nums)} ms` : '—'; })()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Loss</span>
                <span className="font-semibold text-white text-sm">{(() => { const total = pingSamples.length || 0; if (!total) return '—'; const fails = pingSamples.filter(n => n < 0).length; return `${Math.round((fails/total)*100)}%`; })()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Jitter</span>
                <span className="font-semibold text-white text-sm">{(() => { const nums = pingSamples.filter(n => n >= 0); if (nums.length < 2) return '—'; const diffs = nums.slice(1).map((v,i) => Math.abs(v - nums[i])); return `${Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length)} ms`; })()}</span>
              </div>
            </div>

            <div className="h-40 bg-white rounded border border-slate-200 flex relative p-2">
              {/* Y-Axis Labels */}
              <div className="w-12 flex flex-col justify-between text-right py-1 px-2 shrink-0">
                {[...Array(4)].map((_, i) => {
                  const maxVal = Math.max(1, ...pingSamples.filter(n => n >= 0), 100);
                  const label = i === 0 ? maxVal : i === 1 ? Math.round(maxVal * 0.66) : i === 2 ? Math.round(maxVal * 0.33) : 0;
                  return (
                    <span key={i} className="text-[10px] text-slate-500 font-semibold h-0 flex items-end justify-end">
                      {label} ms
                    </span>
                  );
                })}
              </div>

              {/* Recharts Graph */}
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pingSamples.map((val) => ({ value: val < 0 ? null : val }))} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="pingGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#e2e8f0" />
                    <YAxis hide={true} />
                    <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#pingGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex justify-between text-[12px] text-slate-400">
              <span>Failures: {pingSamples.filter(n => n < 0).length}</span>
              <span>Samples: {pingSamples.length}</span>
            </div>
          </div>

          {/* API (card) */}
          <div className="flex flex-col gap-3 flex-1 min-h-0 border-t border-slate-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">API Checks</h3>
                <p className="text-xs text-slate-400">Health endpoint monitoring</p>
              </div>
              <div className="flex gap-2 items-center">
                <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} className="bg-white/6 px-2 py-1 text-xs rounded w-56 border border-slate-700 text-white placeholder-slate-500" placeholder="URL" />
                <button onClick={() => runApiRef.current()} className="px-3 py-1 bg-white/8 rounded text-xs text-white hover:bg-white/16">Check</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Status</span>
                <span className="font-semibold text-white text-sm">{lastApiStatus === null ? <span className="text-red-400">ERR</span> : apiSamples.length && apiSamples[apiSamples.length - 1] < 0 ? <span className="text-red-400">{lastApiStatus} (fail)</span> : <span>{lastApiStatus}</span>}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Last RTT</span>
                <span className="font-semibold text-white text-sm">{apiSamples.length ? (apiSamples[apiSamples.length - 1] >= 0 ? `${apiSamples[apiSamples.length - 1]} ms` : 'fail') : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase">Size</span>
                <span className="font-semibold text-white text-sm">{lastApiSize !== null ? `${lastApiSize} B` : '—'}</span>
              </div>
            </div>

            <div className="h-28 bg-white rounded border border-slate-200 flex relative p-2">
              <div className="w-12 flex flex-col justify-between text-right py-1 px-2 shrink-0">
                {[...Array(3)].map((_, i) => {
                  const maxVal = Math.max(1, ...apiSamples.filter(n => n >= 0), 200);
                  const label = i === 0 ? maxVal : i === 1 ? Math.round(maxVal * 0.5) : 0;
                  return (
                    <span key={i} className="text-[10px] text-slate-500 font-semibold h-0 flex items-end justify-end">
                      {label} ms
                    </span>
                  );
                })}
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={apiSamples.map((val) => ({ value: val < 0 ? null : val }))} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="apiGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0.04" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#e2e8f0" />
                    <YAxis hide={true} />
                    <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#apiGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 shrink-0">
              <p className="font-bold text-white mb-1">Recent:</p>
              <ul className="space-y-0.5">
                {recentApiRef.current.length === 0 ? (
                  <li className="opacity-40">No checks yet</li>
                ) : (
                  recentApiRef.current.slice(0, 4).map((r, idx) => (
                    <li key={idx} className={`${r.status && r.status >= 200 && r.status < 300 ? 'text-green-400' : r.status ? 'text-yellow-400' : 'text-red-400'}`}>
                      {new Date(r.ts).toLocaleTimeString()} — {r.status ?? 'ERR'} {r.time !== null ? `${r.time}ms` : ''} {r.size ? `${r.size}B` : ''}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / System Info - WHITE FOOTER */}
      <div className="bg-white text-[#0a0e27] border-t border-slate-300 px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex gap-6">
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-500 font-black uppercase tracking-widest">Uplink ID</p>
            <p className="text-[9px] font-black">{socket.id?.slice(0, 12).toUpperCase() || 'OFFLINE'}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-500 font-black uppercase tracking-widest">Buffer</p>
            <p className="text-[9px] font-black">{logs.length}/100</p>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-60">
          <Zap size={10} className="text-[#00ADB5]" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Classified Access Only</p>
        </div>
      </div>

      <style>{`
        .custom-scrollbar-dark::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb {
          background: #475569;
          border-radius: 0px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}</style>
    </div>
  );
};

export default LogMonitorPage;

import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_HANDLERS, MOCK_ROSTER } from '../data/mockData';
import { ShieldCheck, PhoneCall, X, Check, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import type { DailyStats, Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

// ─── Shift colour system (matches RosterPage spec) ───────────────────────────
const SHIFT_META: Record<string, {
  label: string;
  time: string;
  accent: string;        // tailwind text colour for badges
  accentHex: string;
  rowBg: string;         // subtle row tint
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  timeBg: string;
  timeText: string;
}> = {
  '6AM-3PM':  { label: 'Morning Shift',    time: '6AM–3PM',   accent: 'text-sky-400',    accentHex: '#38BDF8', rowBg: 'bg-sky-950/20',     badgeBg: 'bg-sky-900/60',    badgeText: 'text-sky-200',    badgeBorder: 'border-sky-700/50',    timeBg: 'bg-sky-900/40',    timeText: 'text-sky-300' },
  '12PM-9PM': { label: 'Afternoon Shift',  time: '12PM–9PM',  accent: 'text-yellow-400', accentHex: '#FACC15', rowBg: 'bg-yellow-950/20',   badgeBg: 'bg-yellow-900/60', badgeText: 'text-yellow-200', badgeBorder: 'border-yellow-700/50', timeBg: 'bg-yellow-900/40', timeText: 'text-yellow-300' },
  '1PM-10PM': { label: 'Afternoon Team',   time: '1PM–10PM',  accent: 'text-amber-400',  accentHex: '#FBBF24', rowBg: 'bg-amber-950/20',    badgeBg: 'bg-amber-900/60',  badgeText: 'text-amber-200',  badgeBorder: 'border-amber-700/50',  timeBg: 'bg-amber-900/40',  timeText: 'text-amber-300' },
  '2PM-11PM': { label: 'Evening Shift',    time: '2PM–11PM',  accent: 'text-orange-400', accentHex: '#FB923C', rowBg: 'bg-orange-950/20',   badgeBg: 'bg-orange-900/60', badgeText: 'text-orange-200', badgeBorder: 'border-orange-700/50', timeBg: 'bg-orange-900/40', timeText: 'text-orange-300' },
  '10PM-7AM': { label: 'Night Shift',      time: '10PM–7AM',  accent: 'text-indigo-400', accentHex: '#818CF8', rowBg: 'bg-indigo-950/30',   badgeBg: 'bg-indigo-900/70', badgeText: 'text-indigo-200', badgeBorder: 'border-indigo-700/50', timeBg: 'bg-indigo-900/50', timeText: 'text-indigo-300' },
};
const getShiftMeta = (shift: string) =>
  SHIFT_META[shift] ?? { label: shift, time: shift, accent: 'text-slate-400', accentHex: '#94A3B8', rowBg: 'bg-slate-800/20', badgeBg: 'bg-slate-800', badgeText: 'text-slate-300', badgeBorder: 'border-slate-600', timeBg: 'bg-slate-800', timeText: 'text-slate-300' };

interface TrackerPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const TrackerPage: React.FC<TrackerPageProps> = ({ selectedDate, setSelectedDate }) => {
  const [handlers, setHandlers] = useState<Handler[]>(() => {
    const s = localStorage.getItem('handlers');
    return s ? JSON.parse(s) : MOCK_HANDLERS;
  });
  const [roster, setRoster] = useState<RosterEntry[]>(() => {
    const s = localStorage.getItem('roster');
    return s ? JSON.parse(s) : MOCK_ROSTER;
  });
  const [stats, setStats] = useState<DailyStats[]>(() => {
    const s = localStorage.getItem('stats');
    return s ? JSON.parse(s) : [];
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [flashMap, setFlashMap] = useState<Record<string, 'positive' | 'negative'>>({});
  const [times, setTimes] = useState({ ist: '', uk: '' });
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callData, setCallData] = useState({ handlerId: '', ticketNumber: '', type: 'New' as 'New' | 'Update' });

  useEffect(() => {
    const update = () => {
      const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
      setTimes({ ist: fmt('Asia/Kolkata'), uk: fmt('Europe/London') });
    };
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onHandlers = (d: Handler[]) => { if (d) { setHandlers(d); localStorage.setItem('handlers', JSON.stringify(d)); } };
    const onRoster   = (d: RosterEntry[]) => { if (d) { setRoster(d);   localStorage.setItem('roster',   JSON.stringify(d)); } };
    const onStats    = (d: DailyStats[])  => { if (d) { setStats(d);    localStorage.setItem('stats',    JSON.stringify(d)); } };
    const onInit = (db: any) => {
      if (!db) return;
      const h = db.handlers || db.agents;
      if (Array.isArray(h))        { setHandlers(h);     localStorage.setItem('handlers', JSON.stringify(h)); }
      if (Array.isArray(db.roster)){ setRoster(db.roster); localStorage.setItem('roster',   JSON.stringify(db.roster)); }
      if (Array.isArray(db.stats)) { setStats(db.stats);  localStorage.setItem('stats',    JSON.stringify(db.stats)); }
      if (db.logs) saveLogsFromServer(db.logs);
    };
    socket.on('handlers_updated', onHandlers);
    socket.on('roster_updated',   onRoster);
    socket.on('stats_updated',    onStats);
    socket.on('log_added', ({ dateStr, logEntry }) => saveSingleLogFromServer(dateStr, logEntry));
    socket.on('init', onInit);
    if (socket.connected) socket.emit('get_initial_data');
    return () => {
      socket.off('handlers_updated', onHandlers);
      socket.off('roster_updated',   onRoster);
      socket.off('stats_updated',    onStats);
      socket.off('log_added');
      socket.off('init', onInit);
    };
  }, []);

  const isShiftNearEnd = (shift: ShiftType) => {
    const now = currentTime;
    const todayStr = now.toLocaleDateString('en-CA');
    const mins = now.getHours() * 60 + now.getMinutes();
    if (selectedDate === todayStr) {
      if (shift === '6AM-3PM'  && mins >= 870)  return true;
      if (shift === '1PM-10PM' && mins >= 1290) return true;
      if (shift === '2PM-11PM' && mins >= 1350) return true;
      if (shift === '12PM-9PM' && mins >= 1230) return true;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toLocaleDateString('en-CA');
    if (selectedDate === yStr && shift === '10PM-7AM' && mins >= 390) return true;
    if (selectedDate < yStr) return true;
    if (selectedDate === yStr && shift !== '10PM-7AM') return true;
    return false;
  };

  const saveStats = (u: DailyStats[]) => {
    setStats(u); localStorage.setItem('stats', JSON.stringify(u)); syncData.updateStats(u);
  };

  const getHandlerStats = (handlerId: string): DailyStats => {
    const s = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
    return { handlerId, date: selectedDate, incidents: Number(s?.incidents||0), sctasks: Number(s?.sctasks||0), calls: Number(s?.calls||0), comments: s?.comments||'' };
  };

  const activeHandlers = useMemo(() => {
    const hidden = new Set(['WO','ML','PL','EL','UL','CO','MID-LEAVE']);
    const order: Record<string,number> = { '6AM-3PM':0,'12PM-9PM':1,'1PM-10PM':2,'2PM-11PM':3,'10PM-7AM':4 };
    return roster
      .filter(r => r.date === selectedDate && !hidden.has(r.shift))
      .map(r => { const h = handlers.find(a => a.id === r.handlerId); return h ? { ...h, shift: r.shift as ShiftType } : null; })
      .filter((a): a is Handler & { shift: ShiftType } => a !== null)
      .sort((a,b) => (order[a.shift]??999) - (order[b.shift]??999));
  }, [selectedDate, roster, handlers]);

  const totalStats = useMemo(() =>
    activeHandlers.reduce((acc, h) => {
      const s = getHandlerStats(h.id);
      acc.incidents += s.incidents; acc.sctasks += s.sctasks; acc.calls += s.calls;
      return acc;
    }, { incidents: 0, sctasks: 0, calls: 0 }),
  [activeHandlers, stats, selectedDate]);

  const updateStat = (handlerId: string, field: keyof DailyStats, value: any) => {
    const handler = handlers.find(a => a.id === handlerId);
    const existing = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
    const final = (field === 'incidents'||field === 'sctasks'||field === 'calls') ? Number(value)||0 : value;
    const old = existing ? existing[field] : (field === 'comments' ? '' : 0);
    const updated = existing
      ? stats.map(s => (s.handlerId===handlerId&&s.date===selectedDate) ? {...s,[field]:final} : s)
      : [...stats, { handlerId, date:selectedDate, incidents:0, sctasks:0, calls:0, comments:'', [field]:final }];
    saveStats(updated);
    if (field !== 'comments') {
      const type = Number(final) > Number(old) ? 'positive' : Number(final) < Number(old) ? 'negative' : 'neutral';
      if (type !== 'neutral') {
        const key = `${handlerId}-${field}`;
        setFlashMap(p => ({...p,[key]:type as 'positive'|'negative'}));
        setTimeout(() => setFlashMap(p => { const n={...p}; delete n[key]; return n; }), 1200);
      }
      addLog('Update Stat', `${handler?.name||handlerId} - ${field}: ${old} -> ${final} (${selectedDate})`, type as any);
    }
  };

  const handleCallSubmit = () => {
    if (!callData.ticketNumber.trim()) return;
    const s = getHandlerStats(callData.handlerId);
    updateStat(callData.handlerId, 'calls', s.calls + 1);
    const h = handlers.find(a => a.id === callData.handlerId);
    addLog('Call Logged', `${h?.name}: Ticket #${callData.ticketNumber} (${callData.type})`, 'positive');
    setCallData({ handlerId:'', ticketNumber:'', type:'New' });
    setIsCallModalOpen(false);
  };

  const navDate = (dir: number) => {
    const [y,m,d] = selectedDate.split('-').map(Number);
    const dt = new Date(y,m-1,d); dt.setDate(dt.getDate()+dir);
    setSelectedDate(dt.toLocaleDateString('en-CA'));
  };

  const dayLabel = new Date(selectedDate+'T00:00:00').toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });

  // Group handlers by shift for the section dividers
  const handlersByShift = useMemo(() => {
    const groups: { shift: ShiftType; handlers: (Handler & { shift: ShiftType })[] }[] = [];
    activeHandlers.forEach(h => {
      const last = groups[groups.length - 1];
      if (last && last.shift === h.shift) last.handlers.push(h);
      else groups.push({ shift: h.shift, handlers: [h] });
    });
    return groups;
  }, [activeHandlers]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-slate-950">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800 shrink-0 bg-slate-900/80 backdrop-blur-sm">
        {/* Left */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-teal-500/20 border border-teal-500/30 rounded-xl flex items-center justify-center">
              <ShieldCheck size={16} className="text-teal-400" />
            </div>
            <div>
              <p className="text-[8px] text-slate-500 font-black uppercase tracking-[0.25em] leading-none">Live Performance Board</p>
              <h1 className="text-[14px] font-black text-white tracking-tight uppercase leading-none mt-0.5">Productivity Tracker</h1>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-700" />

          {/* Date nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => navDate(-1)} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors">
              <ChevronLeft size={14} />
            </button>
            <div className="relative">
              <div className="px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60 cursor-pointer min-w-[130px] text-center">
                <span className="text-[11px] font-black text-white uppercase tracking-widest">{dayLabel}</span>
              </div>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
            </div>
            <button onClick={() => navDate(1)} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Clocks */}
          <div className="hidden md:flex items-center gap-1 bg-slate-800/60 rounded-lg border border-slate-700/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[9px] font-black text-teal-400 tracking-widest">IST</span>
              <span className="text-[12px] font-mono font-semibold text-white tabular-nums">{times.ist}</span>
            </div>
            <div className="w-px h-5 bg-slate-700" />
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[9px] font-black text-slate-400 tracking-widest">GMT</span>
              <span className="text-[12px] font-mono font-semibold text-slate-300 tabular-nums">{times.uk}</span>
            </div>
          </div>
        </div>

        {/* Right — totals */}
        <div className="flex items-center divide-x divide-slate-700/60 bg-slate-800/60 rounded-xl border border-slate-700/50 overflow-hidden">
          {[
            { label: 'Total INC',   value: totalStats.incidents, color: 'text-sky-400' },
            { label: 'Total TASK',  value: totalStats.sctasks,   color: 'text-amber-400' },
            { label: 'Total CALLS', value: totalStats.calls,     color: 'text-teal-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-4 py-2 flex flex-col items-center min-w-[72px]">
              <span className={`text-[7px] font-black uppercase tracking-[0.2em] ${color}`}>{label}</span>
              <span className="text-[18px] font-black text-white tabular-nums leading-none mt-0.5">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeHandlers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-25">
            <ShieldCheck size={56} strokeWidth={1} className="text-slate-400 mb-4" />
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">No Handlers on Shift</p>
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse">
            {/* Sticky header */}
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/60">
                {[
                  { label: 'On Shift',  w: '22%' },
                  { label: 'Shift',     w: '14%' },
                  { label: 'Shift Time',w: '10%' },
                  { label: 'INC',       w: '9%'  },
                  { label: 'TASK',      w: '9%'  },
                  { label: 'CALL',      w: '9%'  },
                  { label: 'Notes',     w: '21%' },
                  { label: 'Total',     w: '6%'  },
                ].map(({ label, w }, i) => (
                  <th key={label} className="px-3 py-2.5 text-center border-r border-slate-800/60 last:border-r-0" style={{ width: w }}>
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {handlersByShift.map(({ shift, handlers: groupHandlers }) => {
                const meta = getShiftMeta(shift);
                return (
                  <React.Fragment key={shift}>
                    {/* Shift group divider */}
                    <tr>
                      <td colSpan={8} className="px-4 py-1.5 border-b border-slate-800/40" style={{ background: `${meta.accentHex}12` }}>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: meta.accentHex, boxShadow: `0 0 6px ${meta.accentHex}80` }} />
                          <span className={`text-[9px] font-black uppercase tracking-[0.25em] ${meta.accent}`}>{meta.label}</span>
                          <span className="text-[8px] text-slate-600 font-black ml-1">{groupHandlers.length} handler{groupHandlers.length !== 1 ? 's' : ''}</span>
                        </div>
                      </td>
                    </tr>

                    {groupHandlers.map(handler => {
                      const hs = getHandlerStats(handler.id);
                      const disabled = isShiftNearEnd(handler.shift);
                      const rowTotal = hs.incidents + hs.sctasks + hs.calls;
                      const flash = (field: string) => {
                        const f = flashMap[`${handler.id}-${field}`];
                        return f === 'positive' ? 'text-emerald-400' : f === 'negative' ? 'text-red-400' : 'text-white';
                      };

                      return (
                        <tr
                          key={handler.id}
                          className={`border-b border-slate-800/40 transition-colors group
                            ${meta.rowBg} hover:brightness-125
                            ${disabled ? 'opacity-30 grayscale pointer-events-none' : ''}
                          `}
                        >
                          {/* Name */}
                          <td className="px-3 py-2 border-r border-slate-800/40">
                            <div className="flex items-center gap-2 justify-center">
                              <span className="text-[13px] font-semibold text-white truncate">{handler.name}</span>
                              {handler.isQH && (
                                <Shield size={11} className="text-yellow-400 shrink-0" />
                              )}
                            </div>
                          </td>

                          {/* Shift label badge */}
                          <td className="px-2 py-2 border-r border-slate-800/40 text-center">
                            <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-black border ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}>
                              {meta.label}
                            </span>
                          </td>

                          {/* Shift time badge */}
                          <td className="px-2 py-2 border-r border-slate-800/40 text-center">
                            <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-black ${meta.timeBg} ${meta.timeText}`}>
                              {handler.shift}
                            </span>
                          </td>

                          {/* INC */}
                          <td className="px-2 py-2 border-r border-slate-800/40">
                            <div className="flex items-center justify-center gap-1.5">
                              <button onClick={() => updateStat(handler.id,'incidents',Math.max(0,hs.incidents-1))} className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white text-sm leading-none flex items-center justify-center transition-colors">−</button>
                              <span className={`w-6 text-center font-black text-[14px] tabular-nums transition-colors ${flash('incidents')}`}>{hs.incidents}</span>
                              <button onClick={() => updateStat(handler.id,'incidents',hs.incidents+1)} className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white text-sm leading-none flex items-center justify-center transition-colors">+</button>
                            </div>
                          </td>

                          {/* TASK */}
                          <td className="px-2 py-2 border-r border-slate-800/40">
                            <div className="flex items-center justify-center gap-1.5">
                              <button onClick={() => updateStat(handler.id,'sctasks',Math.max(0,hs.sctasks-1))} className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white text-sm leading-none flex items-center justify-center transition-colors">−</button>
                              <span className={`w-6 text-center font-black text-[14px] tabular-nums transition-colors ${flash('sctasks')}`}>{hs.sctasks}</span>
                              <button onClick={() => updateStat(handler.id,'sctasks',hs.sctasks+1)} className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white text-sm leading-none flex items-center justify-center transition-colors">+</button>
                            </div>
                          </td>

                          {/* CALL */}
                          <td className="px-2 py-2 border-r border-slate-800/40">
                            <div className="flex items-center justify-center gap-1.5">
                              <button onClick={() => updateStat(handler.id,'calls',Math.max(0,hs.calls-1))} className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white text-sm leading-none flex items-center justify-center transition-colors">−</button>
                              <span className={`w-6 text-center font-black text-[14px] tabular-nums transition-colors ${flash('calls')}`}>{hs.calls}</span>
                              <button
                                onClick={() => { setCallData({...callData, handlerId: handler.id}); setIsCallModalOpen(true); }}
                                className="w-6 h-6 rounded-full bg-teal-500 hover:bg-teal-400 text-white text-sm leading-none flex items-center justify-center transition-colors shadow-sm shadow-teal-500/30 font-black"
                              >+</button>
                            </div>
                          </td>

                          {/* Notes */}
                          <td className="px-2 py-2 border-r border-slate-800/40">
                            <input
                              type="text"
                              placeholder="Log status…"
                              value={hs.comments}
                              onChange={e => updateStat(handler.id,'comments',e.target.value)}
                              className="w-full px-2.5 py-1.5 text-[12px] text-center text-slate-200 bg-slate-800/60 border border-slate-700/50 rounded-lg outline-none focus:border-teal-500/50 focus:bg-slate-800 transition-colors placeholder:text-slate-600"
                            />
                          </td>

                          {/* Total */}
                          <td className="px-2 py-2 text-center">
                            <div
                              className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg font-black text-[13px] tabular-nums"
                              style={{ background: rowTotal > 0 ? `${meta.accentHex}25` : '#1e293b', color: rowTotal > 0 ? meta.accentHex : '#475569' }}
                            >
                              {rowTotal}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Call Modal ─────────────────────────────────────────────────────── */}
      {isCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCallModalOpen(false)} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-[320px] overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <PhoneCall size={16} className="text-teal-400" />
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-white uppercase tracking-widest leading-none">Call Record</h3>
                  <p className="text-[8px] text-slate-500 uppercase tracking-widest mt-0.5">Log productivity entry</p>
                </div>
              </div>
              <button onClick={() => setIsCallModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 transition-all">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* Ticket input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ticket Number</label>
                  <span className="text-[8px] font-black text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="INC1234567"
                  value={callData.ticketNumber}
                  onChange={e => setCallData({...callData, ticketNumber: e.target.value.toUpperCase()})}
                  onKeyDown={e => e.key === 'Enter' && handleCallSubmit()}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold text-sm placeholder:text-slate-600 focus:outline-none focus:border-teal-500/50 transition-colors uppercase tracking-widest"
                />
              </div>

              {/* Type toggle */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Call Type</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-800 rounded-xl border border-slate-700">
                  {(['New','Update'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setCallData({...callData, type: t})}
                      className={`py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${
                        callData.type === t
                          ? 'bg-teal-500 text-white shadow-sm shadow-teal-500/30'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handleCallSubmit}
                className="w-full bg-teal-500 hover:bg-teal-400 text-white py-3 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg shadow-teal-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Check size={16} strokeWidth={3} />
                Submit Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackerPage;

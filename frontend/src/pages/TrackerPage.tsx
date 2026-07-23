import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_HANDLERS, MOCK_ROSTER } from '../data/mockData';
import { ShieldCheck, PhoneCall, X, Check, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import type { DailyStats, Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

// ─── Shift colour system ─────────────────────────────────────────────────────
// Morning  → sky/blue
// Afternoon (12-9, 1-10) → yellow/amber
// Evening  (2-11) → orange
// Night    (10-7) → indigo/violet
const SHIFT_META: Record<string, {
  label: string;
  accent: string;
  accentHex: string;
  rowBg: string;
  rowHover: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  timeBg: string;
  timeText: string;
  dividerBg: string;
  dividerText: string;
  totalBg: string;
  totalText: string;
}> = {
  '6AM-3PM':  {
    label: 'Morning Shift',
    accent: 'text-sky-600',       accentHex: '#0284C7',
    rowBg: 'bg-sky-50/60',        rowHover: 'hover:bg-sky-50',
    badgeBg: 'bg-sky-100',        badgeText: 'text-sky-700',    badgeBorder: 'border-sky-200',
    timeBg: 'bg-sky-100',         timeText: 'text-sky-700',
    dividerBg: 'bg-sky-50',       dividerText: 'text-sky-700',
    totalBg: 'bg-sky-100',        totalText: 'text-sky-800',
  },
  '12PM-9PM': {
    label: 'Afternoon Shift',
    accent: 'text-yellow-600',    accentHex: '#CA8A04',
    rowBg: 'bg-yellow-50/60',     rowHover: 'hover:bg-yellow-50',
    badgeBg: 'bg-yellow-100',     badgeText: 'text-yellow-700', badgeBorder: 'border-yellow-200',
    timeBg: 'bg-yellow-100',      timeText: 'text-yellow-700',
    dividerBg: 'bg-yellow-50',    dividerText: 'text-yellow-700',
    totalBg: 'bg-yellow-100',     totalText: 'text-yellow-800',
  },
  '1PM-10PM': {
    label: 'Afternoon Team',
    accent: 'text-amber-600',     accentHex: '#D97706',
    rowBg: 'bg-amber-50/60',      rowHover: 'hover:bg-amber-50',
    badgeBg: 'bg-amber-100',      badgeText: 'text-amber-700',  badgeBorder: 'border-amber-200',
    timeBg: 'bg-amber-100',       timeText: 'text-amber-700',
    dividerBg: 'bg-amber-50',     dividerText: 'text-amber-700',
    totalBg: 'bg-amber-100',      totalText: 'text-amber-800',
  },
  '2PM-11PM': {
    label: 'Evening Shift',
    accent: 'text-orange-600',    accentHex: '#EA580C',
    rowBg: 'bg-orange-50/60',     rowHover: 'hover:bg-orange-50',
    badgeBg: 'bg-orange-100',     badgeText: 'text-orange-700', badgeBorder: 'border-orange-200',
    timeBg: 'bg-orange-100',      timeText: 'text-orange-700',
    dividerBg: 'bg-orange-50',    dividerText: 'text-orange-700',
    totalBg: 'bg-orange-100',     totalText: 'text-orange-800',
  },
  '10PM-7AM': {
    label: 'Night Shift',
    accent: 'text-indigo-600',    accentHex: '#4F46E5',
    rowBg: 'bg-indigo-50/60',     rowHover: 'hover:bg-indigo-50',
    badgeBg: 'bg-indigo-100',     badgeText: 'text-indigo-700', badgeBorder: 'border-indigo-200',
    timeBg: 'bg-indigo-100',      timeText: 'text-indigo-700',
    dividerBg: 'bg-indigo-50',    dividerText: 'text-indigo-700',
    totalBg: 'bg-indigo-100',     totalText: 'text-indigo-800',
  },
};

const getShiftMeta = (shift: string) =>
  SHIFT_META[shift] ?? {
    label: shift, accent: 'text-slate-600', accentHex: '#475569',
    rowBg: 'bg-slate-50', rowHover: 'hover:bg-slate-100',
    badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', badgeBorder: 'border-slate-200',
    timeBg: 'bg-slate-100', timeText: 'text-slate-600',
    dividerBg: 'bg-slate-50', dividerText: 'text-slate-600',
    totalBg: 'bg-slate-100', totalText: 'text-slate-700',
  };

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
  const [callData, setCallData] = useState({
    handlerId: '', ticketNumber: '', type: 'New' as 'New' | 'Update'
  });

  useEffect(() => {
    const update = () => {
      const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true
      }).format(new Date());
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
    const onHandlers = (d: Handler[])    => { if (d) { setHandlers(d); localStorage.setItem('handlers', JSON.stringify(d)); } };
    const onRoster   = (d: RosterEntry[])=> { if (d) { setRoster(d);   localStorage.setItem('roster',   JSON.stringify(d)); } };
    const onStats    = (d: DailyStats[]) => { if (d) { setStats(d);    localStorage.setItem('stats',    JSON.stringify(d)); } };
    const onInit = (db: any) => {
      if (!db) return;
      const h = db.handlers || db.agents;
      if (Array.isArray(h))         { setHandlers(h);      localStorage.setItem('handlers', JSON.stringify(h)); }
      if (Array.isArray(db.roster)) { setRoster(db.roster); localStorage.setItem('roster',  JSON.stringify(db.roster)); }
      if (Array.isArray(db.stats))  { setStats(db.stats);   localStorage.setItem('stats',   JSON.stringify(db.stats)); }
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
    return {
      handlerId, date: selectedDate,
      incidents: Number(s?.incidents || 0),
      sctasks:   Number(s?.sctasks   || 0),
      calls:     Number(s?.calls     || 0),
      comments:  s?.comments || ''
    };
  };

  const activeHandlers = useMemo(() => {
    const hidden = new Set(['WeekOff','Medical Leave','Planned Leave','Earned Leave','Unplanned Leave','Complimentary Off','MID-LEAVE']);
    const order: Record<string, number> = {
      '6AM-3PM': 0, '12PM-9PM': 1, '1PM-10PM': 2, '2PM-11PM': 3, '10PM-7AM': 4
    };
    return roster
      .filter(r => r.date === selectedDate && !hidden.has(r.shift))
      .map(r => {
        const h = handlers.find(a => a.id === r.handlerId);
        return h ? { ...h, shift: r.shift as ShiftType } : null;
      })
      .filter((a): a is Handler & { shift: ShiftType } => a !== null)
      .sort((a, b) => (order[a.shift] ?? 999) - (order[b.shift] ?? 999));
  }, [selectedDate, roster, handlers]);

  const totalStats = useMemo(() =>
    activeHandlers.reduce((acc, h) => {
      const s = getHandlerStats(h.id);
      acc.incidents += s.incidents;
      acc.sctasks   += s.sctasks;
      acc.calls     += s.calls;
      return acc;
    }, { incidents: 0, sctasks: 0, calls: 0 }),
  [activeHandlers, stats, selectedDate]);

  const updateStat = (handlerId: string, field: keyof DailyStats, value: any) => {
    const handler = handlers.find(a => a.id === handlerId);
    const existing = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
    const final = (field === 'incidents' || field === 'sctasks' || field === 'calls')
      ? Number(value) || 0 : value;
    const old = existing ? existing[field] : (field === 'comments' ? '' : 0);
    const updated = existing
      ? stats.map(s => (s.handlerId === handlerId && s.date === selectedDate) ? { ...s, [field]: final } : s)
      : [...stats, { handlerId, date: selectedDate, incidents: 0, sctasks: 0, calls: 0, comments: '', [field]: final }];
    saveStats(updated);
    if (field !== 'comments') {
      const type = Number(final) > Number(old) ? 'positive' : Number(final) < Number(old) ? 'negative' : 'neutral';
      if (type !== 'neutral') {
        const key = `${handlerId}-${field}`;
        setFlashMap(p => ({ ...p, [key]: type as 'positive' | 'negative' }));
        setTimeout(() => setFlashMap(p => { const n = { ...p }; delete n[key]; return n; }), 1200);
      }
      addLog('Update Stat', `${handler?.name || handlerId} - ${field}: ${old} -> ${final} (${selectedDate})`, type as any);
    }
  };

  const handleCallSubmit = () => {
    if (!callData.ticketNumber.trim()) return;
    const s = getHandlerStats(callData.handlerId);
    updateStat(callData.handlerId, 'calls', s.calls + 1);
    const h = handlers.find(a => a.id === callData.handlerId);
    addLog('Call Logged', `${h?.name}: Ticket #${callData.ticketNumber} (${callData.type})`, 'positive');
    setCallData({ handlerId: '', ticketNumber: '', type: 'New' });
    setIsCallModalOpen(false);
  };

  const navDate = (dir: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + dir);
    setSelectedDate(dt.toLocaleDateString('en-CA'));
  };

  const dayLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });

  // Group consecutive rows by shift for section dividers
  const handlerGroups = useMemo(() => {
    const groups: { shift: ShiftType; handlers: (Handler & { shift: ShiftType })[] }[] = [];
    activeHandlers.forEach(h => {
      const last = groups[groups.length - 1];
      if (last && last.shift === h.shift) last.handlers.push(h);
      else groups.push({ shift: h.shift, handlers: [h] });
    });
    return groups;
  }, [activeHandlers]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-200 shrink-0 bg-white shadow-sm">

        {/* Left side */}
        <div className="flex items-center gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center shadow-md">
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div>
              <p className="text-[7.5px] text-slate-400 font-black uppercase tracking-[0.25em] leading-none">Live Performance Board</p>
              <h1 className="text-[14px] font-black text-slate-900 tracking-tight uppercase leading-none mt-0.5">Productivity Tracker</h1>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-200" />

          {/* Date nav */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navDate(-1)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="relative">
              <div className="px-3 py-1.5 bg-white rounded-lg border border-slate-200 cursor-pointer min-w-[148px] text-center shadow-sm">
                <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">{dayLabel}</span>
              </div>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
              />
            </div>
            <button
              onClick={() => navDate(1)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Clocks */}
          <div className="hidden md:flex items-center gap-0 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 border-r border-slate-200">
              <span className="text-[9px] font-black text-[#00ADB5] tracking-widest uppercase">IST</span>
              <span className="text-[12px] font-black text-slate-800 tabular-nums">{times.ist}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[9px] font-black text-slate-400 tracking-widest uppercase">GMT</span>
              <span className="text-[12px] font-black text-slate-700 tabular-nums">{times.uk}</span>
            </div>
          </div>
        </div>

        {/* Right — totals */}
        <div className="flex items-center divide-x divide-slate-200 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {[
            { label: 'Total INC',   value: totalStats.incidents, color: 'text-sky-600',    dot: 'bg-sky-500' },
            { label: 'Total TASK',  value: totalStats.sctasks,   color: 'text-amber-600',  dot: 'bg-amber-400' },
            { label: 'Total CALLS', value: totalStats.calls,     color: 'text-[#00ADB5]',  dot: 'bg-[#00ADB5]' },
          ].map(({ label, value, color, dot }) => (
            <div key={label} className="px-4 py-2 flex flex-col items-center min-w-[76px]">
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className={`text-[7px] font-black uppercase tracking-[0.2em] ${color}`}>{label}</span>
              </div>
              <span className="text-[18px] font-black text-slate-900 tabular-nums leading-none">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto bg-white">
        {activeHandlers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-20">
            <ShieldCheck size={56} strokeWidth={1} className="text-slate-300 mb-4" />
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">No Handlers on Shift</p>
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse">

            {/* Sticky column headers */}
            <thead className="sticky top-0 z-20 bg-white shadow-sm">
              <tr className="border-b-2 border-slate-200">
                {[
                  { label: 'On Shift',   w: '22%' },
                  { label: 'Shift',      w: '14%' },
                  { label: 'Shift Time', w: '10%' },
                  { label: 'INC',        w: '9%'  },
                  { label: 'TASK',       w: '9%'  },
                  { label: 'CALL',       w: '9%'  },
                  { label: 'Notes',      w: '21%' },
                  { label: 'Total',      w: '6%'  },
                ].map(({ label, w }) => (
                  <th
                    key={label}
                    className="px-3 py-2.5 text-center border-r border-slate-100 last:border-r-0 bg-slate-50"
                    style={{ width: w }}
                  >
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {handlerGroups.map(({ shift, handlers: groupHandlers }) => {
                const meta = getShiftMeta(shift);
                return (
                  <React.Fragment key={shift}>

                    {/* Shift section header row */}
                    <tr>
                      <td
                        colSpan={8}
                        className={`px-4 py-1.5 border-b border-t ${meta.dividerBg}`}
                        style={{ borderColor: `${meta.accentHex}25` }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: meta.accentHex, boxShadow: `0 0 6px ${meta.accentHex}60` }}
                          />
                          <span className={`text-[9px] font-black uppercase tracking-[0.25em] ${meta.dividerText}`}>
                            {meta.label}
                          </span>
                          <span className="text-[8px] text-slate-400 font-bold ml-1">
                            {groupHandlers.length} handler{groupHandlers.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Handler rows */}
                    {groupHandlers.map(handler => {
                      const hs = getHandlerStats(handler.id);
                      const disabled = isShiftNearEnd(handler.shift);
                      const rowTotal = hs.incidents + hs.sctasks + hs.calls;
                      const flash = (field: string) => {
                        const f = flashMap[`${handler.id}-${field}`];
                        return f === 'positive'
                          ? 'text-emerald-600 bg-emerald-50 rounded px-1'
                          : f === 'negative'
                          ? 'text-red-600 bg-red-50 rounded px-1'
                          : 'text-slate-800';
                      };

                      return (
                        <tr
                          key={handler.id}
                          className={`
                            border-b border-slate-100 transition-colors group
                            ${meta.rowBg} ${meta.rowHover}
                            ${disabled ? 'opacity-30 grayscale pointer-events-none' : ''}
                          `}
                        >
                          {/* Name */}
                          <td className="px-3 py-2 border-r border-slate-100">
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-[13px] font-semibold text-slate-800 truncate">{handler.name}</span>
                              {handler.isQH && (
                                <Shield size={11} className="text-amber-500 shrink-0" title="Queue Handler" />
                              )}
                            </div>
                          </td>

                          {/* Shift label */}
                          <td className="px-2 py-2 border-r border-slate-100 text-center">
                            <span className={`
                              inline-flex items-center px-2.5 py-1 rounded-md
                              text-[10px] font-black border
                              ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}
                            `}>
                              {meta.label}
                            </span>
                          </td>

                          {/* Shift time */}
                          <td className="px-2 py-2 border-r border-slate-100 text-center">
                            <span className={`
                              inline-flex items-center px-2 py-1 rounded-md
                              text-[10px] font-black
                              ${meta.timeBg} ${meta.timeText}
                            `}>
                              {handler.shift}
                            </span>
                          </td>

                          {/* INC */}
                          <td className="px-2 py-2 border-r border-slate-100">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => updateStat(handler.id, 'incidents', Math.max(0, hs.incidents - 1))}
                                className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center text-sm leading-none transition-colors shadow-sm"
                              >−</button>
                              <span className={`w-7 text-center font-black text-[14px] tabular-nums transition-all ${flash('incidents')}`}>
                                {hs.incidents}
                              </span>
                              <button
                                onClick={() => updateStat(handler.id, 'incidents', hs.incidents + 1)}
                                className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center text-sm leading-none transition-colors shadow-sm"
                              >+</button>
                            </div>
                          </td>

                          {/* TASK */}
                          <td className="px-2 py-2 border-r border-slate-100">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => updateStat(handler.id, 'sctasks', Math.max(0, hs.sctasks - 1))}
                                className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center text-sm leading-none transition-colors shadow-sm"
                              >−</button>
                              <span className={`w-7 text-center font-black text-[14px] tabular-nums transition-all ${flash('sctasks')}`}>
                                {hs.sctasks}
                              </span>
                              <button
                                onClick={() => updateStat(handler.id, 'sctasks', hs.sctasks + 1)}
                                className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center text-sm leading-none transition-colors shadow-sm"
                              >+</button>
                            </div>
                          </td>

                          {/* CALL */}
                          <td className="px-2 py-2 border-r border-slate-100">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => updateStat(handler.id, 'calls', Math.max(0, hs.calls - 1))}
                                className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center text-sm leading-none transition-colors shadow-sm"
                              >−</button>
                              <span className={`w-7 text-center font-black text-[14px] tabular-nums transition-all ${flash('calls')}`}>
                                {hs.calls}
                              </span>
                              <button
                                onClick={() => {
                                  setCallData({ ...callData, handlerId: handler.id });
                                  setIsCallModalOpen(true);
                                }}
                                className="w-6 h-6 rounded-full bg-[#00ADB5] hover:bg-[#00ADB5]/80 text-white flex items-center justify-center text-sm leading-none font-black transition-colors shadow-sm"
                              >+</button>
                            </div>
                          </td>

                          {/* Notes */}
                          <td className="px-2 py-2 border-r border-slate-100">
                            <input
                              type="text"
                              placeholder="Log status…"
                              value={hs.comments}
                              onChange={e => updateStat(handler.id, 'comments', e.target.value)}
                              className="w-full px-2.5 py-1.5 text-[12px] text-center text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#00ADB5]/20 focus:border-[#00ADB5]/40 transition-all placeholder:text-slate-300 shadow-sm"
                            />
                          </td>

                          {/* Total */}
                          <td className="px-2 py-2 text-center">
                            <span className={`
                              inline-flex items-center justify-center px-2.5 py-1 rounded-lg
                              font-black text-[13px] tabular-nums
                              ${rowTotal > 0 ? `${meta.totalBg} ${meta.totalText}` : 'bg-slate-100 text-slate-400'}
                            `}>
                              {rowTotal}
                            </span>
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
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setIsCallModalOpen(false)}
          />
          <div className="relative bg-white border border-slate-200 rounded-2xl w-[320px] overflow-hidden shadow-2xl shadow-slate-200/80">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#00ADB5]/10 border border-[#00ADB5]/20 flex items-center justify-center">
                  <PhoneCall size={16} className="text-[#00ADB5]" />
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest leading-none">Call Record</h3>
                  <p className="text-[8px] text-slate-400 uppercase tracking-widest mt-0.5">Log productivity entry</p>
                </div>
              </div>
              <button
                onClick={() => setIsCallModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Ticket input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ticket Number</label>
                  <span className="text-[8px] font-black text-[#00ADB5] bg-[#00ADB5]/10 px-2 py-0.5 rounded-full">Required</span>
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="INC1234567"
                  value={callData.ticketNumber}
                  onChange={e => setCallData({ ...callData, ticketNumber: e.target.value.toUpperCase() })}
                  onKeyDown={e => e.key === 'Enter' && handleCallSubmit()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-bold text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#00ADB5]/20 focus:border-[#00ADB5]/40 transition-all uppercase tracking-widest"
                />
              </div>

              {/* Type toggle */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Call Type</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  {(['New', 'Update'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setCallData({ ...callData, type: t })}
                      className={`py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${
                        callData.type === t
                          ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                          : 'text-slate-400 hover:text-slate-600'
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
                className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Check size={15} strokeWidth={3} />
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

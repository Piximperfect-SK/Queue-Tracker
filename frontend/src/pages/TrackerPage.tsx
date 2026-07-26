import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_HANDLERS, MOCK_ROSTER } from '../data/mockData';
import { ShieldCheck, PhoneCall, X, Check, ChevronLeft, ChevronRight, Shield, ChevronDown } from 'lucide-react';
import type { DailyStats, Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

// ─── Shift colour system ─────────────────────────────────────────────────────
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
  headerBg: string;
  headerBorder: string;
  btnMinus: string;
  btnPlus: string;
  glowColor: string;
}> = {
  '6AM-3PM': {
    label: 'Morning Shift',
    accent: 'text-sky-600', accentHex: '#0284C7',
    rowBg: 'bg-sky-50/40', rowHover: 'hover:bg-sky-50/80',
    badgeBg: 'bg-sky-100', badgeText: 'text-sky-700', badgeBorder: 'border-sky-200',
    timeBg: 'bg-sky-100', timeText: 'text-sky-700',
    dividerBg: 'bg-sky-50', dividerText: 'text-sky-700',
    totalBg: 'bg-sky-100', totalText: 'text-sky-800',
    headerBg: 'bg-gradient-to-r from-sky-50 to-white',
    headerBorder: 'border-sky-200',
    btnMinus: '#64748b',
    btnPlus: '#0284C7',
    glowColor: 'rgba(2,132,199,0.35)',
  },
  '12PM-9PM': {
    label: 'Afternoon Shift',
    accent: 'text-yellow-600', accentHex: '#CA8A04',
    rowBg: 'bg-yellow-50/40', rowHover: 'hover:bg-yellow-50/80',
    badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-700', badgeBorder: 'border-yellow-200',
    timeBg: 'bg-yellow-100', timeText: 'text-yellow-700',
    dividerBg: 'bg-yellow-50', dividerText: 'text-yellow-700',
    totalBg: 'bg-yellow-100', totalText: 'text-yellow-800',
    headerBg: 'bg-gradient-to-r from-yellow-50 to-white',
    headerBorder: 'border-yellow-200',
    btnMinus: '#64748b',
    btnPlus: '#CA8A04',
    glowColor: 'rgba(202,138,4,0.35)',
  },
  '1PM-10PM': {
    label: 'Afternoon Team',
    accent: 'text-amber-600', accentHex: '#D97706',
    rowBg: 'bg-amber-50/40', rowHover: 'hover:bg-amber-50/80',
    badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', badgeBorder: 'border-amber-200',
    timeBg: 'bg-amber-100', timeText: 'text-amber-700',
    dividerBg: 'bg-amber-50', dividerText: 'text-amber-700',
    totalBg: 'bg-amber-100', totalText: 'text-amber-800',
    headerBg: 'bg-gradient-to-r from-amber-50 to-white',
    headerBorder: 'border-amber-200',
    btnMinus: '#64748b',
    btnPlus: '#D97706',
    glowColor: 'rgba(217,119,6,0.35)',
  },
  '2PM-11PM': {
    label: 'Evening Shift',
    accent: 'text-orange-600', accentHex: '#EA580C',
    rowBg: 'bg-orange-50/40', rowHover: 'hover:bg-orange-50/80',
    badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', badgeBorder: 'border-orange-200',
    timeBg: 'bg-orange-100', timeText: 'text-orange-700',
    dividerBg: 'bg-orange-50', dividerText: 'text-orange-700',
    totalBg: 'bg-orange-100', totalText: 'text-orange-800',
    headerBg: 'bg-gradient-to-r from-orange-50 to-white',
    headerBorder: 'border-orange-200',
    btnMinus: '#64748b',
    btnPlus: '#EA580C',
    glowColor: 'rgba(234,88,12,0.35)',
  },
  '10PM-7AM': {
    label: 'Night Shift',
    accent: 'text-indigo-600', accentHex: '#4F46E5',
    rowBg: 'bg-indigo-50/40', rowHover: 'hover:bg-indigo-50/80',
    badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-700', badgeBorder: 'border-indigo-200',
    timeBg: 'bg-indigo-100', timeText: 'text-indigo-700',
    dividerBg: 'bg-indigo-50', dividerText: 'text-indigo-700',
    totalBg: 'bg-indigo-100', totalText: 'text-indigo-800',
    headerBg: 'bg-gradient-to-r from-indigo-50 to-white',
    headerBorder: 'border-indigo-200',
    btnMinus: '#64748b',
    btnPlus: '#4F46E5',
    glowColor: 'rgba(79,70,229,0.35)',
  },
};

const getShiftMeta = (shift: string) =>
  SHIFT_META[shift] ?? {
    label: shift, accent: 'text-slate-600', accentHex: '#475569',
    rowBg: 'bg-slate-50/40', rowHover: 'hover:bg-slate-100/80',
    badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', badgeBorder: 'border-slate-200',
    timeBg: 'bg-slate-100', timeText: 'text-slate-600',
    dividerBg: 'bg-slate-50', dividerText: 'text-slate-600',
    totalBg: 'bg-slate-100', totalText: 'text-slate-700',
    headerBg: 'bg-gradient-to-r from-slate-50 to-white',
    headerBorder: 'border-slate-200',
    btnMinus: '#64748b',
    btnPlus: '#475569',
    glowColor: 'rgba(71,85,105,0.25)',
  };

interface TrackerPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

// 3D tactile button component
const TactileBtn: React.FC<{
  onClick: () => void;
  color: string;
  glow: string;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ onClick, color, glow, children, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: `linear-gradient(145deg, ${color}ee, ${color}cc)`,
      boxShadow: `0 4px 0 0 ${color}88, 0 6px 12px ${glow}, inset 0 1px 0 rgba(255,255,255,0.25)`,
      border: `1px solid ${color}99`,
    }}
    className="w-9 h-9 rounded-xl text-white font-black text-lg flex items-center justify-center
      transition-all duration-100 active:translate-y-[3px] active:shadow-none select-none
      hover:brightness-110 disabled:opacity-30 disabled:pointer-events-none shrink-0"
  >
    {children}
  </button>
);

const MinusBtn: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: 'linear-gradient(145deg, #6b7280, #4b5563)',
      boxShadow: '0 4px 0 0 #374151, 0 6px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
      border: '1px solid #4b556388',
    }}
    className="w-9 h-9 rounded-xl text-white font-black text-lg flex items-center justify-center
      transition-all duration-100 active:translate-y-[3px] active:shadow-none select-none
      hover:brightness-110 disabled:opacity-30 disabled:pointer-events-none shrink-0"
  >
    −
  </button>
);

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
  // Track which shift groups are collapsed (default: all expanded)
  const [collapsedShifts, setCollapsedShifts] = useState<Set<string>>(new Set());

  const toggleShift = (shift: string) => {
    setCollapsedShifts(prev => {
      const next = new Set(prev);
      if (next.has(shift)) next.delete(shift);
      else next.add(shift);
      return next;
    });
  };

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
    const onHandlers = (d: Handler[]) => { if (d) { setHandlers(d); localStorage.setItem('handlers', JSON.stringify(d)); } };
    const onRoster = (d: RosterEntry[]) => { if (d) { setRoster(d); localStorage.setItem('roster', JSON.stringify(d)); } };
    const onStats = (d: DailyStats[]) => { if (d) { setStats(d); localStorage.setItem('stats', JSON.stringify(d)); } };
    const onInit = (db: any) => {
      if (!db) return;
      const h = db.handlers || db.agents;
      if (Array.isArray(h)) { setHandlers(h); localStorage.setItem('handlers', JSON.stringify(h)); }
      if (Array.isArray(db.roster)) { setRoster(db.roster); localStorage.setItem('roster', JSON.stringify(db.roster)); }
      if (Array.isArray(db.stats)) { setStats(db.stats); localStorage.setItem('stats', JSON.stringify(db.stats)); }
      if (db.logs) saveLogsFromServer(db.logs);
    };
    socket.on('handlers_updated', onHandlers);
    socket.on('roster_updated', onRoster);
    socket.on('stats_updated', onStats);
    socket.on('log_added', ({ dateStr, logEntry }) => saveSingleLogFromServer(dateStr, logEntry));
    socket.on('init', onInit);
    if (socket.connected) socket.emit('get_initial_data');
    return () => {
      socket.off('handlers_updated', onHandlers);
      socket.off('roster_updated', onRoster);
      socket.off('stats_updated', onStats);
      socket.off('log_added');
      socket.off('init', onInit);
    };
  }, []);

  const isShiftNearEnd = (shift: ShiftType) => {
    const now = currentTime;
    const todayStr = now.toLocaleDateString('en-CA');
    const mins = now.getHours() * 60 + now.getMinutes();
    if (selectedDate === todayStr) {
      if (shift === '6AM-3PM' && mins >= 870) return true;
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
      sctasks: Number(s?.sctasks || 0),
      calls: Number(s?.calls || 0),
      comments: s?.comments || ''
    };
  };

  const activeHandlers = useMemo(() => {
    const hidden = new Set(['WeekOff', 'Medical Leave', 'Planned Leave', 'Earned Leave', 'Unplanned Leave', 'Complimentary Off', 'MID-LEAVE']);
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
      acc.sctasks += s.sctasks;
      acc.calls += s.calls;
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
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-200 shrink-0 bg-white">

        {/* Left side */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-slate-900 rounded-lg flex items-center justify-center shadow-md">
              <ShieldCheck size={14} className="text-white" />
            </div>
            <div>
              <p className="text-[6.5px] text-slate-400 font-black uppercase tracking-[0.25em] leading-none">Live Board</p>
              <h1 className="text-[12px] font-black text-slate-900 tracking-tight uppercase leading-none mt-0.5">Productivity</h1>
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
        <div className="flex items-center divide-x divide-slate-100 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
          {[
            { label: 'INC', value: totalStats.incidents, color: 'text-sky-600', dot: 'bg-sky-500' },
            { label: 'TASK', value: totalStats.sctasks, color: 'text-amber-600', dot: 'bg-amber-400' },
            { label: 'CALLS', value: totalStats.calls, color: 'text-[#00ADB5]', dot: 'bg-[#00ADB5]' },
          ].map(({ label, value, color, dot }) => (
            <div key={label} className="px-3 py-1 flex flex-col items-center min-w-[60px]">
              <div className="flex items-center gap-1">
                <div className={`w-1 h-1 rounded-full ${dot}`} />
                <span className={`text-[6.5px] font-black uppercase tracking-wider ${color}`}>{label}</span>
              </div>
              <span className="text-[14px] font-black text-slate-900 tabular-nums leading-none">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Table — no outer scroll, fits viewport ──────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col">
        {activeHandlers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-20">
            <ShieldCheck size={56} strokeWidth={1} className="text-slate-300 mb-4" />
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">No Handlers on Shift</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">

            {/* Sticky column headers */}
            <div className="shrink-0 border-b border-slate-200 bg-slate-50">
              <div className="grid bg-slate-50" style={{ gridTemplateColumns: '28px 18% 10% 9% 1fr 1fr 1fr 18% 7%' }}>
                {[
                  { label: '', w: '' },
                  { label: 'Agent', w: '' },
                  { label: 'Shift', w: '' },
                  { label: 'Time', w: '' },
                  { label: 'INC', w: '' },
                  { label: 'TASK', w: '' },
                  { label: 'CALL', w: '' },
                  { label: 'Status / Notes', w: '' },
                  { label: 'Total', w: '' },
                ].map(({ label }, i) => (
                  <div
                    key={i}
                    className="px-1 py-1.5 text-center border-r border-slate-100 last:border-r-0 flex items-center justify-center"
                  >
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Shift groups — each takes proportional flex space */}
            <div className="flex-1 min-h-0 flex flex-col divide-y divide-slate-100">
              {handlerGroups.map(({ shift, handlers: groupHandlers }) => {
                const meta = getShiftMeta(shift);
                const isCollapsed = collapsedShifts.has(shift);
                const groupTotal = groupHandlers.reduce((acc, h) => {
                  const s = getHandlerStats(h.id);
                  return acc + s.incidents + s.sctasks + s.calls;
                }, 0);

                return (
                  <div
                    key={shift}
                    className={`flex flex-col transition-all duration-200 ${isCollapsed ? 'shrink-0' : 'flex-1 min-h-0'}`}
                  >
                    {/* ── Shift header row (clickable) ── */}
                    <button
                      onClick={() => toggleShift(shift)}
                      className={`
                        shrink-0 w-full flex items-center gap-2 px-3 py-1
                        border-b transition-colors cursor-pointer
                        ${meta.headerBg} ${meta.headerBorder}
                        hover:brightness-[0.97]
                      `}
                      style={{ borderColor: `${meta.accentHex}25` }}
                    >
                      {/* Colour dot */}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.accentHex }} />

                      {/* Shift label */}
                      <span className={`text-[9px] font-black uppercase tracking-widest ${meta.dividerText} flex-1 text-left`}>
                        {meta.label}
                        <span className="ml-2 text-[8px] font-semibold opacity-50">{shift}</span>
                      </span>

                      {/* Agent count badge */}
                      <span
                        className="text-[8px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: `${meta.accentHex}18`, color: meta.accentHex }}
                      >
                        {groupHandlers.length} agent{groupHandlers.length !== 1 ? 's' : ''}
                      </span>

                      {/* Total for shift (only show when collapsed so it's not lost) */}
                      {isCollapsed && groupTotal > 0 && (
                        <span
                          className="text-[9px] font-black px-2.5 py-0.5 rounded-full tabular-nums"
                          style={{ background: `${meta.accentHex}22`, color: meta.accentHex }}
                        >
                          {groupTotal} total
                        </span>
                      )}

                      {/* Chevron */}
                      <ChevronDown
                        size={13}
                        className="transition-transform duration-200 shrink-0"
                        style={{
                          color: meta.accentHex,
                          transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        }}
                      />
                    </button>

                    {/* ── Handler rows (hidden when collapsed) ── */}
                    {!isCollapsed && (
                      <div className="flex-1 min-h-0 overflow-hidden flex flex-col divide-y divide-slate-100/80">
                        {groupHandlers.map(handler => {
                          const hs = getHandlerStats(handler.id);
                          const disabled = isShiftNearEnd(handler.shift);
                          const rowTotal = hs.incidents + hs.sctasks + hs.calls;

                          const flash = (field: string) => {
                            const f = flashMap[`${handler.id}-${field}`];
                            return f === 'positive'
                              ? 'text-emerald-600 bg-emerald-50 rounded px-1 scale-110'
                              : f === 'negative'
                              ? 'text-red-600 bg-red-50 rounded px-1 scale-110'
                              : 'text-slate-800';
                          };

                          return (
                            <div
                              key={handler.id}
                              className={`
                                flex-1 grid items-center transition-colors group
                                ${meta.rowBg} ${meta.rowHover}
                                ${disabled ? 'opacity-30 grayscale pointer-events-none' : ''}
                              `}
                              style={{ gridTemplateColumns: '28px 18% 10% 9% 1fr 1fr 1fr 18% 7%' }}
                            >
                              {/* Collapse toggle spacer */}
                              <div className="h-full border-r border-slate-100/80" />

                              {/* Name */}
                              <div className="px-2 py-1 border-r border-slate-100/80 flex items-center justify-center gap-1.5 h-full">
                                <span className="text-[12px] font-bold text-slate-800 truncate">{handler.name}</span>
                                {handler.isQH && (
                                  <Shield size={10} className="text-amber-500 shrink-0" title="Queue Handler" />
                                )}
                              </div>

                              {/* Shift label */}
                              <div className="px-1 py-1 border-r border-slate-100/80 flex items-center justify-center h-full">
                                <span className={`
                                  inline-flex items-center px-2 py-0.5 rounded
                                  text-[7px] font-black border leading-none
                                  ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}
                                `}>
                                  {meta.label}
                                </span>
                              </div>

                              {/* Shift time */}
                              <div className="px-1 py-1 border-r border-slate-100/80 flex items-center justify-center h-full">
                                <span className={`
                                  inline-flex items-center px-1.5 py-0.5 rounded
                                  text-[8px] font-black leading-none
                                  ${meta.timeBg} ${meta.timeText}
                                `}>
                                  {handler.shift}
                                </span>
                              </div>

                              {/* INC */}
                              <div className="px-2 py-1 border-r border-slate-100/80 flex items-center justify-center gap-2 h-full">
                                <MinusBtn onClick={() => updateStat(handler.id, 'incidents', Math.max(0, hs.incidents - 1))} />
                                <span className={`w-7 text-center font-black text-[15px] tabular-nums transition-all ${flash('incidents')}`}>
                                  {hs.incidents}
                                </span>
                                <TactileBtn
                                  onClick={() => updateStat(handler.id, 'incidents', hs.incidents + 1)}
                                  color={meta.btnPlus}
                                  glow={meta.glowColor}
                                >+</TactileBtn>
                              </div>

                              {/* TASK */}
                              <div className="px-2 py-1 border-r border-slate-100/80 flex items-center justify-center gap-2 h-full">
                                <MinusBtn onClick={() => updateStat(handler.id, 'sctasks', Math.max(0, hs.sctasks - 1))} />
                                <span className={`w-7 text-center font-black text-[15px] tabular-nums transition-all ${flash('sctasks')}`}>
                                  {hs.sctasks}
                                </span>
                                <TactileBtn
                                  onClick={() => updateStat(handler.id, 'sctasks', hs.sctasks + 1)}
                                  color={meta.btnPlus}
                                  glow={meta.glowColor}
                                >+</TactileBtn>
                              </div>

                              {/* CALL */}
                              <div className="px-2 py-1 border-r border-slate-100/80 flex items-center justify-center gap-2 h-full">
                                <MinusBtn onClick={() => updateStat(handler.id, 'calls', Math.max(0, hs.calls - 1))} />
                                <span className={`w-7 text-center font-black text-[15px] tabular-nums transition-all ${flash('calls')}`}>
                                  {hs.calls}
                                </span>
                                <TactileBtn
                                  onClick={() => {
                                    setCallData({ ...callData, handlerId: handler.id });
                                    setIsCallModalOpen(true);
                                  }}
                                  color="#00ADB5"
                                  glow="rgba(0,173,181,0.35)"
                                >+</TactileBtn>
                              </div>

                              {/* Notes */}
                              <div className="px-1 py-1 border-r border-slate-100/80 flex items-center h-full">
                                <input
                                  type="text"
                                  placeholder="Log status…"
                                  value={hs.comments}
                                  onChange={e => updateStat(handler.id, 'comments', e.target.value)}
                                  className="w-full px-2 py-1 text-[11px] text-center text-slate-700 bg-transparent border border-transparent rounded-lg outline-none focus:ring-1 focus:ring-[#00ADB5]/20 focus:border-[#00ADB5]/40 transition-all placeholder:text-slate-200"
                                />
                              </div>

                              {/* Total */}
                              <div className="px-1 py-1 flex items-center justify-center h-full">
                                <span className={`
                                  inline-flex items-center justify-center px-2 py-0.5 rounded-md
                                  font-black text-[12px] tabular-nums
                                  ${rowTotal > 0 ? `${meta.totalBg} ${meta.totalText}` : 'bg-slate-100 text-slate-400'}
                                `}>
                                  {rowTotal}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
                style={{
                  background: 'linear-gradient(145deg, #1e293b, #0f172a)',
                  boxShadow: '0 5px 0 0 #020617, 0 8px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
                className="w-full text-white py-3 rounded-xl font-black text-[11px] uppercase tracking-widest
                  transition-all duration-100 active:translate-y-[4px] active:shadow-none
                  flex items-center justify-center gap-2"
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

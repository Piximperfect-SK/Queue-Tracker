import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MOCK_HANDLERS, MOCK_ROSTER } from '../data/mockData';
import { ShieldCheck, PhoneCall, X, Check, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import type { DailyStats, Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

const normalizeCount = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

const normalizeDailyStat = (stat: DailyStats): DailyStats => ({
  ...stat,
  incidents: normalizeCount(stat.incidents),
  sctasks: normalizeCount(stat.sctasks),
  calls: normalizeCount(stat.calls),
  comments: typeof stat.comments === 'string' ? stat.comments : '',
});

// ── Shift colour palette (Excel-style solid fills) ────────────────────────
const SHIFT_STYLE: Record<string, {
  label: string; hex: string;
  rowBg: string; rowBgAlt: string; rowText: string;
  headerBg: string; headerText: string; headerBorder: string;
}> = {
  '6AM-3PM':  {
    label: 'Morning',    hex: '#0284C7',
    rowBg: '#e0f2fe',    rowBgAlt: '#bae6fd', rowText: '#0c4a6e',
    headerBg: '#0369a1', headerText: '#ffffff', headerBorder: '#0284C7',
  },
  '12PM-9PM': {
    label: 'Afternoon',  hex: '#b45309',
    rowBg: '#fef9c3',    rowBgAlt: '#fde68a', rowText: '#713f12',
    headerBg: '#92400e', headerText: '#ffffff', headerBorder: '#b45309',
  },
  '1PM-10PM': {
    label: 'Aft. Team',  hex: '#d97706',
    rowBg: '#fff7ed',    rowBgAlt: '#fed7aa', rowText: '#7c2d12',
    headerBg: '#b45309', headerText: '#ffffff', headerBorder: '#d97706',
  },
  '2PM-11PM': {
    label: 'Evening',    hex: '#ea580c',
    rowBg: '#fff7ed',    rowBgAlt: '#fdba74', rowText: '#7c2d12',
    headerBg: '#c2410c', headerText: '#ffffff', headerBorder: '#ea580c',
  },
  '10PM-7AM': {
    label: 'Night',      hex: '#4f46e5',
    rowBg: '#eef2ff',    rowBgAlt: '#c7d2fe', rowText: '#1e1b4b',
    headerBg: '#3730a3', headerText: '#ffffff', headerBorder: '#4f46e5',
  },
};
const getStyle = (shift: string) => SHIFT_STYLE[shift] ?? {
  label: shift, hex: '#475569',
  rowBg: '#f8fafc', rowBgAlt: '#e2e8f0', rowText: '#1e293b',
  headerBg: '#334155', headerText: '#ffffff', headerBorder: '#475569',
};

// ── Inline editable number cell ───────────────────────────────────────────
const EditCell: React.FC<{
  value: number;
  onChange: (v: number) => void;
  flash: 'positive' | 'negative' | null;
  isCall?: boolean;
  onCallClick?: () => void;
  textColor: string;
}> = ({ value, onChange, flash, isCall, onCallClick, textColor }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    if (isCall && onCallClick) { onCallClick(); return; }
    setDraft(String(value));
    setEditing(true);
  };

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  const commit = () => {
    const n = Math.max(0, parseInt(draft, 10) || 0);
    onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-full h-full text-center font-black text-[13px] outline-none bg-white border-2 border-[#00ADB5] tabular-nums"
        style={{ color: textColor }}
        type="number" min={0}
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      title={isCall ? 'Click to log call' : 'Click to edit'}
      className="w-full h-full flex items-center justify-center cursor-pointer select-none transition-all"
      style={{
        fontWeight: 900,
        fontSize: 14,
        fontVariantNumeric: 'tabular-nums',
        color: flash === 'positive' ? '#16a34a'
             : flash === 'negative' ? '#dc2626'
             : value > 0 ? textColor : '#94a3b8',
        background: flash === 'positive' ? '#dcfce7'
                  : flash === 'negative' ? '#fee2e2'
                  : 'transparent',
      }}
    >
      {value}
      {isCall && value === 0 && (
        <PhoneCall size={9} className="ml-1 opacity-30" />
      )}
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────
interface TrackerPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

// ═════════════════════════════════════════════════════════════════════════
const TrackerPage: React.FC<TrackerPageProps> = ({ selectedDate, setSelectedDate }) => {
  const [handlers, setHandlers] = useState<Handler[]>(() => {
    const s = localStorage.getItem('handlers'); return s ? JSON.parse(s) : MOCK_HANDLERS;
  });
  const [roster, setRoster] = useState<RosterEntry[]>(() => {
    const s = localStorage.getItem('roster'); return s ? JSON.parse(s) : MOCK_ROSTER;
  });
  const [stats, setStats] = useState<DailyStats[]>(() => {
    const s = localStorage.getItem('stats'); return s ? JSON.parse(s).map((row: DailyStats) => normalizeDailyStat(row)) : [];
  });
  const [currentTime, setCurrentTime]   = useState(new Date());
  const [flashMap, setFlashMap]         = useState<Record<string, 'positive' | 'negative'>>({});
  const [times, setTimes]               = useState({ ist: '', uk: '' });
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callData, setCallData]         = useState({ handlerId: '', ticketNumber: '', type: 'New' as 'New' | 'Update' });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(28);

  // ── Compute optimal row height so everything fits with zero scroll ──────
  useEffect(() => {
    const compute = () => {
      if (!wrapRef.current) return;
      const totalH    = wrapRef.current.clientHeight;
      const topbarH   = 40;  // fixed topbar
      const colHeadH  = 26;  // column header row
      const shiftRows = handlerGroups.length;           // one header row per shift
      const agentRows = activeHandlers.length;
      const totalRows = shiftRows + agentRows;
      const available = totalH - topbarH - colHeadH;
      const h = totalRows > 0 ? Math.max(22, Math.floor(available / totalRows)) : 28;
      setRowH(h);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  });

  // ── Clocks ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true
      }).format(new Date());
      setTimes({ ist: fmt('Asia/Kolkata'), uk: fmt('Europe/London') });
    };
    update(); const id = setInterval(update, 10000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Socket sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onHandlers = (d: Handler[]) => { if (d) { setHandlers(d); localStorage.setItem('handlers', JSON.stringify(d)); } };
    const onRoster   = (d: RosterEntry[]) => { if (d) { setRoster(d); localStorage.setItem('roster', JSON.stringify(d)); } };
    const onStats    = (d: DailyStats[]) => { if (d) { setStats(d); localStorage.setItem('stats', JSON.stringify(d)); } };
    const onInit     = (db: any) => {
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
    const normalized = u.map(normalizeDailyStat);
    setStats(normalized); localStorage.setItem('stats', JSON.stringify(normalized)); syncData.updateStats(normalized);
  };

  const getHandlerStats = (handlerId: string): DailyStats => {
    const s = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
    return {
      handlerId, date: selectedDate,
      incidents: normalizeCount(s?.incidents || 0),
      sctasks:   normalizeCount(s?.sctasks   || 0),
      calls:     normalizeCount(s?.calls     || 0),
      comments:  s?.comments || '',
    };
  };

  const activeHandlers = useMemo(() => {
    const hidden = new Set(['WeekOff','Medical Leave','Planned Leave','Earned Leave','Unplanned Leave','Complimentary Off','MID-LEAVE']);
    const order: Record<string, number> = { '6AM-3PM':0,'12PM-9PM':1,'1PM-10PM':2,'2PM-11PM':3,'10PM-7AM':4 };
    return roster
      .filter(r => r.date === selectedDate && !hidden.has(r.shift))
      .map(r => { const h = handlers.find(a => a.id === r.handlerId); return h ? { ...h, shift: r.shift as ShiftType } : null; })
      .filter((a): a is Handler & { shift: ShiftType } => a !== null)
      .sort((a, b) => (order[a.shift] ?? 999) - (order[b.shift] ?? 999));
  }, [selectedDate, roster, handlers]);

  const totalStats = useMemo(() =>
    activeHandlers.reduce((acc, h) => {
      const s = getHandlerStats(h.id);
      acc.incidents += s.incidents; acc.sctasks += s.sctasks; acc.calls += s.calls;
      return acc;
    }, { incidents: 0, sctasks: 0, calls: 0 }),
    [activeHandlers, stats, selectedDate]);

  const updateStat = (handlerId: string, field: keyof DailyStats, value: any) => {
    const handler  = handlers.find(a => a.id === handlerId);
    const existing = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
    const final    = (field === 'incidents' || field === 'sctasks' || field === 'calls') ? normalizeCount(value) : value;
    const old      = existing ? existing[field] : (field === 'comments' ? '' : 0);
    const updated  = existing
      ? stats.map(s => (s.handlerId === handlerId && s.date === selectedDate) ? { ...s, [field]: final } : s)
      : [...stats, { handlerId, date: selectedDate, incidents:0, sctasks:0, calls:0, comments:'', [field]: final }];
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

  // grand total row
  const grandTotal = totalStats.incidents + totalStats.sctasks + totalStats.calls;

  // col widths — fixed, Excel-style
  const COLS = {
    sno:      '36px',
    name:     '1fr',
    shift:    '80px',
    timing:   '90px',
    inc:      '80px',
    task:     '80px',
    call:     '80px',
    notes:    '1fr',
    total:    '64px',
  };
  const gridCols = `${COLS.sno} ${COLS.name} ${COLS.shift} ${COLS.timing} ${COLS.inc} ${COLS.task} ${COLS.call} ${COLS.notes} ${COLS.total}`;

  // border style
  const BORDER = '1px solid #cbd5e1';
  const BORDER_DARK = '1px solid #94a3b8';

  return (
    <div ref={wrapRef} className="h-full w-full flex flex-col overflow-hidden bg-white select-none">

      {/* ══ TOPBAR ════════════════════════════════════════════════════════ */}
      <div style={{ height: 40, borderBottom: BORDER_DARK, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', background: '#f8fafc' }}>

        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 26, height: 26, background: '#0f172a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={13} color="white" />
            </div>
            <div style={{ lineHeight: 1 }}>
              <div style={{ fontSize: 6, color: '#94a3b8', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Live Board</div>
              <div style={{ fontSize: 11, color: '#0f172a', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Productivity Tracker</div>
            </div>
          </div>

          <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

          {/* Date nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => navDate(-1)} style={{ width: 24, height: 24, border: BORDER, borderRadius: 4, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={13} color="#64748b" />
            </button>
            <div style={{ position: 'relative' }}>
              <div style={{ padding: '3px 10px', background: '#fff', border: BORDER_DARK, borderRadius: 4, fontSize: 11, fontWeight: 900, color: '#0f172a', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {dayLabel}
              </div>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
            </div>
            <button onClick={() => navDate(1)} style={{ width: 24, height: 24, border: BORDER, borderRadius: 4, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronRight size={13} color="#64748b" />
            </button>
          </div>

          {/* Clocks */}
          <div style={{ display: 'flex', border: BORDER, borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
            {[{ label: 'IST', val: times.ist, color: '#00ADB5' }, { label: 'GMT', val: times.uk, color: '#64748b' }].map((c, i) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderLeft: i ? BORDER : 'none' }}>
                <span style={{ fontSize: 8, fontWeight: 900, color: c.color, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{c.label}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{c.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — totals */}
        <div style={{ display: 'flex', border: BORDER_DARK, borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
          {[
            { label: 'INC',   value: totalStats.incidents, color: '#0284c7', bg: '#e0f2fe' },
            { label: 'TASK',  value: totalStats.sctasks,   color: '#b45309', bg: '#fef9c3' },
            { label: 'CALLS', value: totalStats.calls,     color: '#00ADB5', bg: '#f0fdfa' },
            { label: 'TOTAL', value: grandTotal,           color: '#0f172a', bg: '#f1f5f9' },
          ].map((t, i) => (
            <div key={t.label} style={{ padding: '2px 12px', borderLeft: i ? BORDER_DARK : 'none', background: t.bg, textAlign: 'center', minWidth: 52 }}>
              <div style={{ fontSize: 8, fontWeight: 900, color: t.color, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{t.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: t.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ TABLE ═════════════════════════════════════════════════════════ */}
      {activeHandlers.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.2 }}>
          <ShieldCheck size={48} strokeWidth={1} color="#94a3b8" />
          <div style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3em', marginTop: 12 }}>No Handlers on Shift</div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* Column header */}
          <div style={{
            display: 'grid', gridTemplateColumns: gridCols,
            height: 26, flexShrink: 0,
            background: '#1e293b', borderBottom: '2px solid #0f172a',
          }}>
            {[
              { label: '#' },
              { label: 'Agent Name' },
              { label: 'Shift' },
              { label: 'Timing' },
              { label: 'Incidents' },
              { label: 'SC Tasks' },
              { label: 'Calls' },
              { label: 'Status / Notes' },
              { label: 'Total' },
            ].map(({ label }, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: i < 8 ? '1px solid #334155' : 'none',
                fontSize: 9, fontWeight: 900, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '0.18em',
              }}>
                {label}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {handlerGroups.map(({ shift, handlers: groupHandlers }) => {
              const st = getStyle(shift);
              let globalIdx = activeHandlers.findIndex(h => h.id === groupHandlers[0].id);

              return (
                <React.Fragment key={shift}>
                  {/* ── Shift header row ── */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: gridCols,
                    height: rowH,
                    background: st.headerBg,
                    borderBottom: `1px solid ${st.headerBorder}`,
                    borderTop: `2px solid ${st.headerBorder}`,
                  }}>
                    {/* Span all cols via absolute positioning trick — use single cell spanning */}
                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', opacity: 0.7, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 900, color: st.headerText, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                        {st.label}
                      </span>
                      <span style={{ fontSize: 9, color: st.headerText, opacity: 0.6, letterSpacing: '0.1em' }}>{shift}</span>
                      <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: st.headerText, opacity: 0.75, background: 'rgba(255,255,255,0.15)', borderRadius: 9, padding: '1px 8px' }}>
                        {groupHandlers.length} agent{groupHandlers.length !== 1 ? 's' : ''}
                      </span>
                      {/* Shift totals */}
                      {(() => {
                        const si = groupHandlers.reduce((a, h) => a + getHandlerStats(h.id).incidents, 0);
                        const st2 = groupHandlers.reduce((a, h) => a + getHandlerStats(h.id).sctasks,  0);
                        const sc = groupHandlers.reduce((a, h) => a + getHandlerStats(h.id).calls,     0);
                        const tot = si + st2 + sc;
                        return tot > 0 ? (
                          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 900, color: '#fff', opacity: 0.85, background: 'rgba(0,0,0,0.2)', borderRadius: 9, padding: '1px 10px', fontVariantNumeric: 'tabular-nums' }}>
                            INC {si} · TASK {st2} · CALLS {sc} · {tot} total
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {/* ── Agent rows ── */}
                  {groupHandlers.map((handler, rowIdx) => {
                    const hs       = getHandlerStats(handler.id);
                    const disabled = isShiftNearEnd(handler.shift);
                    const rowTotal = hs.incidents + hs.sctasks + hs.calls;
                    const isAlt    = rowIdx % 2 === 1;
                    const bg       = isAlt ? st.rowBgAlt : st.rowBg;
                    const tc       = st.rowText;
                    const sno      = globalIdx + rowIdx + 1;
                    const cellBorder = `1px solid ${st.hex}30`;

                    return (
                      <div
                        key={handler.id}
                        style={{
                          display: 'grid', gridTemplateColumns: gridCols,
                          height: rowH,
                          background: disabled ? '#f1f5f9' : bg,
                          borderBottom: cellBorder,
                          opacity: disabled ? 0.4 : 1,
                          pointerEvents: disabled ? 'none' : 'auto',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => !disabled && (e.currentTarget.style.filter = 'brightness(0.95)')}
                        onMouseLeave={e => (e.currentTarget.style.filter = '')}
                      >
                        {/* S.No */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderRight: cellBorder, fontSize: 10, fontWeight: 700, color: '#94a3b8', fontVariantNumeric:'tabular-nums' }}>
                          {sno}
                        </div>

                        {/* Name */}
                        <div style={{ display:'flex', alignItems:'center', gap: 5, padding: '0 8px', borderRight: cellBorder, overflow:'hidden' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: tc, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{handler.name}</span>
                          {handler.isQH && <Shield size={10} color="#f59e0b" title="Queue Handler" style={{ flexShrink:0 }} />}
                        </div>

                        {/* Shift label */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderRight: cellBorder }}>
                          <span style={{ fontSize: 9, fontWeight: 900, color: st.headerBg, background: `${st.hex}20`, border: `1px solid ${st.hex}50`, borderRadius: 4, padding: '1px 6px', textTransform:'uppercase', letterSpacing:'0.1em', whiteSpace:'nowrap' }}>
                            {st.label}
                          </span>
                        </div>

                        {/* Timing */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderRight: cellBorder }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: tc, fontVariantNumeric:'tabular-nums' }}>{handler.shift}</span>
                        </div>

                        {/* INC */}
                        <div style={{ borderRight: cellBorder, overflow:'hidden' }}>
                          <EditCell
                            value={hs.incidents}
                            onChange={v => updateStat(handler.id, 'incidents', v)}
                            flash={flashMap[`${handler.id}-incidents`] ?? null}
                            textColor={tc}
                          />
                        </div>

                        {/* TASK */}
                        <div style={{ borderRight: cellBorder, overflow:'hidden' }}>
                          <EditCell
                            value={hs.sctasks}
                            onChange={v => updateStat(handler.id, 'sctasks', v)}
                            flash={flashMap[`${handler.id}-sctasks`] ?? null}
                            textColor={tc}
                          />
                        </div>

                        {/* CALL */}
                        <div style={{ borderRight: cellBorder, overflow:'hidden' }}>
                          <EditCell
                            value={hs.calls}
                            onChange={v => updateStat(handler.id, 'calls', v)}
                            flash={flashMap[`${handler.id}-calls`] ?? null}
                            textColor={tc}
                            isCall
                            onCallClick={() => {
                              setCallData({ ...callData, handlerId: handler.id });
                              setIsCallModalOpen(true);
                            }}
                          />
                        </div>

                        {/* Notes */}
                        <div style={{ borderRight: cellBorder, display:'flex', alignItems:'center', padding:'0 4px' }}>
                          <input
                            type="text"
                            placeholder="Add note…"
                            value={hs.comments}
                            onChange={e => updateStat(handler.id, 'comments', e.target.value)}
                            style={{
                              width:'100%', height:'100%', border:'none', outline:'none',
                              background:'transparent', fontSize: 11, color: tc,
                              padding:'0 4px',
                            }}
                            onFocus={e => (e.currentTarget.style.background = '#fff')}
                            onBlur={e => (e.currentTarget.style.background = 'transparent')}
                          />
                        </div>

                        {/* Total */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <span style={{
                            fontSize: 13, fontWeight: 900, fontVariantNumeric:'tabular-nums',
                            color: rowTotal > 0 ? st.headerBg : '#cbd5e1',
                            background: rowTotal > 0 ? `${st.hex}20` : 'transparent',
                            borderRadius: 4, padding: rowTotal > 0 ? '1px 8px' : '0',
                          }}>
                            {rowTotal || '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* ── Grand Total row ── */}
            <div style={{
              display: 'grid', gridTemplateColumns: gridCols,
              height: rowH,
              background: '#1e293b',
              borderTop: '2px solid #0f172a',
            }}>
              <div style={{ gridColumn: '1 / 5', display:'flex', alignItems:'center', padding:'0 12px' }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em' }}>Grand Total</span>
              </div>
              {[
                { v: totalStats.incidents, c: '#38bdf8' },
                { v: totalStats.sctasks,   c: '#fbbf24' },
                { v: totalStats.calls,     c: '#2dd4bf' },
              ].map(({ v, c }, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'center', borderLeft:'1px solid #334155' }}>
                  <span style={{ fontSize: 15, fontWeight: 900, color: c, fontVariantNumeric:'tabular-nums' }}>{v}</span>
                </div>
              ))}
              <div style={{ borderLeft:'1px solid #334155' }} />
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderLeft:'1px solid #334155' }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: '#f8fafc', fontVariantNumeric:'tabular-nums' }}>{grandTotal}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ CALL MODAL ════════════════════════════════════════════════════ */}
      {isCallModalOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.25)', backdropFilter:'blur(4px)' }} onClick={() => setIsCallModalOpen(false)} />
          <div style={{ position:'relative', background:'#fff', border:'1px solid #e2e8f0', borderRadius:16, width:320, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:'#f0fdfa', border:'1px solid #99f6e4', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <PhoneCall size={15} color="#00ADB5" />
                </div>
                <div>
                  <div style={{ fontSize:11, fontWeight:900, color:'#0f172a', textTransform:'uppercase', letterSpacing:'0.2em', lineHeight:1 }}>Log Call</div>
                  <div style={{ fontSize:8, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em', marginTop:2 }}>Productivity entry</div>
                </div>
              </div>
              <button onClick={() => setIsCallModalOpen(false)} style={{ width:32, height:32, border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8 }}>
                <X size={16} color="#94a3b8" />
              </button>
            </div>

            <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <div style={{ fontSize:9, fontWeight:900, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em', marginBottom:6 }}>Ticket Number</div>
                <input
                  autoFocus
                  type="text"
                  placeholder="INC1234567"
                  value={callData.ticketNumber}
                  onChange={e => setCallData({ ...callData, ticketNumber: e.target.value.toUpperCase() })}
                  onKeyDown={e => e.key === 'Enter' && handleCallSubmit()}
                  style={{ width:'100%', padding:'10px 14px', border:'2px solid #e2e8f0', borderRadius:10, fontSize:13, fontWeight:700, color:'#0f172a', outline:'none', letterSpacing:'0.15em', textTransform:'uppercase', boxSizing:'border-box' }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#00ADB5')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
                />
              </div>

              <div>
                <div style={{ fontSize:9, fontWeight:900, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em', marginBottom:6 }}>Call Type</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, padding:4, background:'#f1f5f9', borderRadius:10 }}>
                  {(['New','Update'] as const).map(t => (
                    <button key={t} onClick={() => setCallData({ ...callData, type: t })} style={{
                      padding:'10px 0', borderRadius:8, border: callData.type === t ? '1px solid #e2e8f0' : 'none',
                      background: callData.type === t ? '#fff' : 'transparent',
                      fontSize:10, fontWeight:900, color: callData.type === t ? '#0f172a' : '#94a3b8',
                      cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.15em', transition:'all 0.15s',
                    }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleCallSubmit} style={{
                width:'100%', padding:'12px 0', borderRadius:10, border:'none', cursor:'pointer',
                background:'linear-gradient(145deg,#1e293b,#0f172a)',
                boxShadow:'0 4px 0 #020617, 0 6px 16px rgba(0,0,0,0.25)',
                fontSize:11, fontWeight:900, color:'#fff', textTransform:'uppercase', letterSpacing:'0.2em',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                transition:'all 0.1s',
              }}
                onMouseDown={e => { e.currentTarget.style.transform='translateY(3px)'; e.currentTarget.style.boxShadow='0 1px 0 #020617'; }}
                onMouseUp={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='0 4px 0 #020617, 0 6px 16px rgba(0,0,0,0.25)'; }}
              >
                <Check size={14} strokeWidth={3} />
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackerPage;

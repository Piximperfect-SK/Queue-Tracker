import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MOCK_HANDLERS, SHIFTS, MOCK_ROSTER } from '../data/mockData';
import { GripVertical, Plus, X, Trash2, AlertCircle, Upload, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import type { Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';
import { addLogForDate } from '../utils/logger';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ALL_SHIFT_TYPES: ShiftType[] = [
  '6AM-3PM', '12PM-9PM', '1PM-10PM', '2PM-11PM', '10PM-7AM',
  'WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'
];

const MAX_SHIFT_VISIBLE = 8;

type ImportFeedback = {
  message: string;
  tone: 'success' | 'warning' | 'error';
};

const normalizeCellValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
};

const parseExcelDate = (value: unknown) => {
  if (typeof value === 'number') {
    const parseDateCode = (XLSX as any).SSF?.parse_date_code;
    if (typeof parseDateCode === 'function') {
      const decoded = parseDateCode(value);
      if (decoded?.y && decoded?.m && decoded?.d) {
        const month = String(decoded.m).padStart(2, '0');
        const day = String(decoded.d).padStart(2, '0');
        return `${decoded.y}-${month}-${day}`;
      }
    }
  }
  const formatted = normalizeCellValue(value);
  if (!formatted) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  const parsed = new Date(formatted);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
};

const createAgentId = () => {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

// ─── Shift Config ────────────────────────────────────────────────────────────
const SHIFT_CONFIG: Record<string, {
  accent: string;       // tailwind bg for dot/badge
  accentHex: string;   // raw hex for borders / inline styles
  label: string;
  headerBg: string;    // column header bg
  colBg: string;       // column body bg
  pillBg: string;      // handler pill bg
  pillText: string;
  pillBorder: string;
}> = {
  '6AM-3PM':  { accent: 'bg-sky-400',    accentHex: '#38BDF8', label: 'Morning',   headerBg: 'bg-sky-900/90',    colBg: 'bg-sky-950/30',    pillBg: 'bg-sky-800/70',    pillText: 'text-sky-100',    pillBorder: 'border-sky-600/60' },
  '12PM-9PM': { accent: 'bg-yellow-400', accentHex: '#FACC15', label: 'Afternoon', headerBg: 'bg-yellow-800/90', colBg: 'bg-yellow-950/30', pillBg: 'bg-yellow-800/70', pillText: 'text-yellow-100', pillBorder: 'border-yellow-600/60' },
  '1PM-10PM': { accent: 'bg-amber-400',  accentHex: '#FBBF24', label: 'Afternoon', headerBg: 'bg-amber-800/90',  colBg: 'bg-amber-950/30',  pillBg: 'bg-amber-800/70',  pillText: 'text-amber-100',  pillBorder: 'border-amber-600/60' },
  '2PM-11PM': { accent: 'bg-orange-400', accentHex: '#FB923C', label: 'Evening',   headerBg: 'bg-orange-900/90', colBg: 'bg-orange-950/30', pillBg: 'bg-orange-800/70', pillText: 'text-orange-100', pillBorder: 'border-orange-600/60' },
  '10PM-7AM': { accent: 'bg-indigo-400', accentHex: '#818CF8', label: 'Night',     headerBg: 'bg-indigo-950/95', colBg: 'bg-indigo-950/40', pillBg: 'bg-indigo-900/80', pillText: 'text-indigo-200', pillBorder: 'border-indigo-700/60' },
};

const LEAVE_CONFIG: Record<string, { label: string; color: string; textColor: string; borderColor: string }> = {
  'WO':       { label: 'Week Off',     color: '#475569', textColor: 'text-slate-300',  borderColor: 'border-slate-600' },
  'ML':       { label: 'Medical',      color: '#EC4899', textColor: 'text-pink-200',   borderColor: 'border-pink-700' },
  'PL':       { label: 'Privilege',    color: '#F43F5E', textColor: 'text-rose-200',   borderColor: 'border-rose-700' },
  'EL':       { label: 'Emergency',    color: '#EF4444', textColor: 'text-red-200',    borderColor: 'border-red-700' },
  'UL':       { label: 'Unpaid',       color: '#6B7280', textColor: 'text-gray-300',   borderColor: 'border-gray-600' },
  'CO':       { label: 'Comp-Off',     color: '#10B981', textColor: 'text-emerald-200',borderColor: 'border-emerald-700' },
  'MID-LEAVE':{ label: 'Mid-Leave',    color: '#FB7185', textColor: 'text-rose-200',   borderColor: 'border-rose-600' },
};

const getShiftConfig = (shift: string) =>
  SHIFT_CONFIG[shift] ?? { accent: 'bg-slate-500', accentHex: '#64748B', label: shift, headerBg: 'bg-slate-800', colBg: 'bg-slate-900/20', pillBg: 'bg-slate-800/60', pillText: 'text-slate-200', pillBorder: 'border-slate-600' };

// ─── Blueprint helpers ───────────────────────────────────────────────────────
const BLUEPRINT_CACHE_KEY = 'roster_blueprint';

const mergeRosterEntries = (base: RosterEntry[], additions: RosterEntry[]) => {
  const merged = [...base];
  additions.forEach(entry => {
    const idx = merged.findIndex(r => r.handlerId === entry.handlerId && r.date === entry.date);
    if (idx > -1) merged[idx] = entry;
    else merged.push(entry);
  });
  return merged;
};

const loadBlueprint = (): Record<string, RosterEntry[]> => {
  try { return JSON.parse(localStorage.getItem(BLUEPRINT_CACHE_KEY) || '{}'); }
  catch { return {}; }
};

const applyBlueprint = (base: RosterEntry[]) => {
  const blueprintEntries = Object.values(loadBlueprint()).flat();
  if (!blueprintEntries.length) return base;
  return mergeRosterEntries(base, blueprintEntries);
};

// ─── DroppableContainer ──────────────────────────────────────────────────────
const DroppableContainer: React.FC<{ id: string; children: React.ReactNode; className?: string }> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className ?? ''} ${isOver ? 'ring-2 ring-inset ring-white/20 bg-white/5' : ''} transition-all duration-200`}>
      {children}
    </div>
  );
};

// ─── SortableHandler (the pill card) ────────────────────────────────────────
interface SortableHandlerProps {
  handler: Handler;
  shift: string;
  onShiftChange: (handlerId: string, shift: ShiftType) => void;
  onDelete: (handlerId: string) => void;
  shiftOptions: ShiftType[];
  compact?: boolean;
}

const SortableHandler: React.FC<SortableHandlerProps> = ({ handler, shift, onShiftChange, onDelete, shiftOptions, compact }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: handler.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.2 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const cfg = getShiftConfig(shift);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`
        group relative flex items-center gap-2 rounded-lg border transition-all cursor-default
        ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'}
        ${cfg.pillBg} ${cfg.pillBorder} border
        hover:brightness-110 active:scale-[0.98]
      `}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/60 shrink-0 transition-colors"
      >
        <GripVertical size={12} />
      </div>

      {/* QH badge */}
      {handler.isQH && (
        <Shield size={10} className="text-yellow-400 shrink-0" />
      )}

      {/* Name */}
      <span className={`flex-1 font-semibold truncate ${cfg.pillText} ${compact ? 'text-[11px]' : 'text-[12px]'} leading-none`}>
        {handler.name}
      </span>

      {/* Hover controls */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <select
          value={shift}
          onChange={(e) => onShiftChange(handler.id, e.target.value as ShiftType)}
          className="text-[8px] font-black bg-black/30 text-white/70 px-1 py-0.5 rounded border-none focus:ring-0 outline-none cursor-pointer uppercase tracking-wider max-w-[58px]"
        >
          {shiftOptions.map(s => (
            <option key={s} value={s} className="bg-slate-900 text-white">{s}</option>
          ))}
        </select>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(handler.id); }}
          className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </li>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
interface RosterPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const RosterPage: React.FC<RosterPageProps> = ({ selectedDate, setSelectedDate }) => {
  const [handlers, setHandlers] = useState<Handler[]>(() => {
    const saved = localStorage.getItem('handlers');
    return saved ? JSON.parse(saved) as Handler[] : MOCK_HANDLERS;
  });
  const [roster, setRoster] = useState<RosterEntry[]>(() => {
    const saved = localStorage.getItem('roster');
    const base = saved ? JSON.parse(saved) as RosterEntry[] : MOCK_ROSTER;
    return applyBlueprint(base);
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentShift, setNewAgentShift] = useState<ShiftType | ''>('');
  const [newAgentShiftOpen, setNewAgentShiftOpen] = useState(false);
  const [leaveOperation, setLeaveOperation] = useState<{
    type: 'assign' | 'remove';
    handlerId: string;
    fromShift?: ShiftType;
    toShift?: ShiftType | 'UNASSIGNED';
  } | null>(null);
  const [importStatus, setImportStatus] = useState<ImportFeedback | null>(null);
  const [isImportingRoster, setIsImportingRoster] = useState(false);
  const [times, setTimes] = useState({ ist: '', uk: '' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Clocks
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

  // ── Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const availableShifts = useMemo(() => {
    const s = new Set(SHIFTS);
    roster.filter(e => e.date === selectedDate).forEach(e => s.add(e.shift));
    return Array.from(s);
  }, [roster, selectedDate]);

  const shiftPickerOptions = useMemo(() => {
    return Array.from(new Set([...ALL_SHIFT_TYPES, ...availableShifts]));
  }, [availableShifts]);

  // ── Socket
  useEffect(() => {
    const handleHandlers = (data: Handler[]) => {
      if (data) { setHandlers(data); localStorage.setItem('handlers', JSON.stringify(data)); }
    };
    const handleRoster = (data: RosterEntry[]) => {
      if (data) {
        const merged = applyBlueprint(data);
        setRoster(merged); localStorage.setItem('roster', JSON.stringify(merged));
      }
    };
    const handleInit = (db: any) => {
      if (!db) return;
      const h = db.handlers || db.agents;
      if (Array.isArray(h)) { setHandlers(h); localStorage.setItem('handlers', JSON.stringify(h)); }
      if (Array.isArray(db.roster)) {
        const m = applyBlueprint(db.roster);
        setRoster(m); localStorage.setItem('roster', JSON.stringify(m));
      }
      if (db.logs) saveLogsFromServer(db.logs);
    };

    socket.on('handlers_updated', handleHandlers);
    socket.on('roster_updated', handleRoster);
    socket.on('log_added', ({ dateStr, logEntry }) => saveSingleLogFromServer(dateStr, logEntry));
    socket.on('init', handleInit);
    if (socket.connected) socket.emit('get_initial_data');

    return () => {
      socket.off('handlers_updated', handleHandlers);
      socket.off('roster_updated', handleRoster);
      socket.off('log_added');
      socket.off('init', handleInit);
    };
  }, []);

  // ── Nav log
  const firstNavRef = useRef(true);
  useEffect(() => {
    if (firstNavRef.current) { firstNavRef.current = false; return; }
    addLogForDate(selectedDate, 'NAVIGATE', `Visited ${selectedDate}`);
    addLog('NAVIGATE', `Visited ${selectedDate}`);
  }, [selectedDate]);

  const LEAVE_TYPES = ['EL', 'PL', 'UL', 'MID-LEAVE', 'WO', 'ML', 'CO'];

  const updateShift = (handlerId: string, shift: ShiftType) => {
    if (LEAVE_TYPES.includes(shift)) {
      setLeaveOperation({ type: 'assign', handlerId, toShift: shift });
      return;
    }
    executeShiftUpdate(handlerId, shift);
  };

  const executeShiftUpdate = (handlerId: string, shift: ShiftType) => {
    const handler = handlers.find(a => a.id === handlerId);
    const updated = [...roster];
    const idx = updated.findIndex(r => r.handlerId === handlerId && r.date === selectedDate);
    const oldShift = idx > -1 ? updated[idx].shift : 'Unassigned';
    if (idx > -1) updated[idx] = { ...updated[idx], shift };
    else updated.push({ handlerId, date: selectedDate, shift });
    setRoster(updated);
    localStorage.setItem('roster', JSON.stringify(updated));
    syncData.updateRoster(updated);
    addLog('Update Shift', `${handler?.name || handlerId}: ${oldShift} -> ${shift} (Date: ${selectedDate})`);
  };

  function deleteHandlerGlobally(handlerId: string) {
    const h = handlers.find(a => a.id === handlerId);
    const uh = handlers.filter(a => a.id !== handlerId);
    const ur = roster.filter(r => r.handlerId !== handlerId);
    setHandlers(uh); setRoster(ur);
    localStorage.setItem('handlers', JSON.stringify(uh));
    localStorage.setItem('roster', JSON.stringify(ur));
    syncData.updateHandlers(uh); syncData.updateRoster(ur);
    addLog('Delete Agent', `Permanently deleted handler: ${h?.name || handlerId}`, 'negative');
  }

  const handleRosterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importRosterFromFile(file);
    e.target.value = '';
  };

  const importRosterFromFile = async (file: File) => {
    setImportStatus(null);
    setIsImportingRoster(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) { setImportStatus({ message: 'File contains no sheets.', tone: 'error' }); return; }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
      if (!rows.length) { setImportStatus({ message: 'No rows found.', tone: 'error' }); return; }

      const newHandlers: Handler[] = [];
      const parsedEntries: RosterEntry[] = [];
      const rowErrors: string[] = [];
      const lookup = new Map<string, string>();
      handlers.forEach(h => lookup.set(h.name.trim().toLowerCase(), h.id));

      const match = (key: string, req: string[], forb: string[] = []) => {
        const k = key.trim().toLowerCase();
        return req.every(t => k.includes(t)) && !forb.some(t => k.includes(t));
      };

      rows.forEach((row, ri) => {
        const entries = Object.entries(row);
        if (entries.every(([, v]) => normalizeCellValue(v) === '')) return;
        const hCell = entries.find(([k]) => match(k, ['agent'])) ?? entries.find(([k]) => match(k, ['handler'])) ?? entries.find(([k]) => match(k, ['name'], ['shift']));
        const sCell = entries.find(([k]) => match(k, ['shift'])) ?? entries.find(([k]) => match(k, ['status']));
        const dCell = entries.find(([k]) => match(k, ['date'])) ?? entries.find(([k]) => match(k, ['day']));

        const name = normalizeCellValue(hCell?.[1]);
        const rawShift = normalizeCellValue(sCell?.[1]);
        const date = parseExcelDate(dCell?.[1]);
        const label = `Row ${ri + 2}`;

        if (!name) { rowErrors.push(`${label}: name missing`); return; }
        if (!date) { rowErrors.push(`${label}: invalid date`); return; }
        if (!rawShift) { rowErrors.push(`${label}: shift missing`); return; }

        let sv = rawShift.toUpperCase().replace(/\s+/g, '');
        if (sv === 'OFF' || sv === 'WEEKOFF') sv = 'WO';
        const matched = ALL_SHIFT_TYPES.find(s => s.toUpperCase().replace(/\s+/g, '') === sv);
        if (matched) sv = matched;

        const key = name.toLowerCase();
        let hid = lookup.get(key);
        if (!hid) { hid = createAgentId(); lookup.set(key, hid); newHandlers.push({ id: hid, name, isQH: false }); }
        parsedEntries.push({ handlerId: hid, date, shift: sv });
      });

      if (!parsedEntries.length) { setImportStatus({ message: 'No valid rows found.', tone: 'error' }); return; }

      const merged = mergeRosterEntries(roster, parsedEntries);
      setRoster(merged); localStorage.setItem('roster', JSON.stringify(merged)); syncData.updateRoster(merged);
      if (newHandlers.length) {
        const uh = [...handlers, ...newHandlers];
        setHandlers(uh); localStorage.setItem('handlers', JSON.stringify(uh)); syncData.updateHandlers(uh);
      }
      const dates = parsedEntries.map(e => e.date).sort();
      if (dates.length) setSelectedDate(dates[0]);

      const tone: ImportFeedback['tone'] = rowErrors.length ? 'warning' : 'success';
      setImportStatus({
        message: `Imported ${parsedEntries.length} row(s).${newHandlers.length ? ` +${newHandlers.length} new handler(s).` : ''}${rowErrors.length ? ` (${rowErrors.length} skipped)` : ''}`,
        tone
      });
      addLog('Import Roster', `Imported ${parsedEntries.length} rows from ${file.name}`, 'positive');
    } catch (err) {
      setImportStatus({ message: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, tone: 'error' });
    } finally {
      setIsImportingRoster(false);
    }
  };

  const handleLeaveConfirm = () => {
    if (!leaveOperation) return;
    if (leaveOperation.type === 'assign' && leaveOperation.toShift) {
      executeShiftUpdate(leaveOperation.handlerId, leaveOperation.toShift as ShiftType);
    }
    if (leaveOperation.type === 'remove') {
      const to = leaveOperation.toShift;
      if (to === 'UNASSIGNED') {
        const ur = roster.filter(r => !(r.handlerId === leaveOperation.handlerId && r.date === selectedDate));
        setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur)); syncData.updateRoster(ur);
        const h = handlers.find(a => a.id === leaveOperation.handlerId);
        addLog('Update Shift', `${h?.name || leaveOperation.handlerId}: ${leaveOperation.fromShift} -> Unassigned`);
      } else if (to) {
        executeShiftUpdate(leaveOperation.handlerId, to as ShiftType);
      }
    }
    setLeaveOperation(null);
  };

  const handleAddAgentConfirm = () => {
    const name = newAgentName.trim();
    if (!name) return;
    const id = createAgentId();
    const newHandler: Handler = { id, name, isQH: false };
    const uh = [...handlers, newHandler];
    setHandlers(uh); localStorage.setItem('handlers', JSON.stringify(uh)); syncData.updateHandlers(uh);
    if (newAgentShift) {
      const ur = mergeRosterEntries(roster, [{ handlerId: id, date: selectedDate, shift: newAgentShift }]);
      setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur)); syncData.updateRoster(ur);
      addLog('Register Agent', `Registered: ${name} → ${newAgentShift} on ${selectedDate}`, 'positive');
    } else {
      addLog('Register Agent', `Registered: ${name}`, 'positive');
    }
    setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false);
  };

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveId(null);
    if (!over) return;
    const handlerId = active.id as string;
    const overId = over.id as string;
    const isHorizontal = Math.abs(delta.x) > Math.abs(delta.y);
    const currentEntry = roster.find(r => r.handlerId === handlerId && r.date === selectedDate);

    if (currentEntry && LEAVE_TYPES.includes(currentEntry.shift)) {
      if (overId === 'OFF_DUTY') return;
      if (availableShifts.includes(overId as ShiftType)) {
        if (overId === currentEntry.shift) return;
        setLeaveOperation({ type: 'remove', handlerId, fromShift: currentEntry.shift, toShift: overId as ShiftType });
        return;
      }
      if (overId === 'UNASSIGNED') {
        setLeaveOperation({ type: 'remove', handlerId, fromShift: currentEntry.shift, toShift: 'UNASSIGNED' });
        return;
      }
    }

    if (availableShifts.includes(overId as ShiftType)) updateShift(handlerId, overId as ShiftType);
    else if (overId === 'OFF_DUTY') updateShift(handlerId, 'WO');
    else if (overId === 'UNASSIGNED') {
      const ur = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
      setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur));
    } else if (overId === 'TRASH' && isHorizontal) {
      deleteHandlerGlobally(handlerId);
    } else {
      const overEntry = roster.find(r => r.handlerId === overId && r.date === selectedDate);
      if (overEntry) updateShift(handlerId, overEntry.shift);
      else if (getUnassignedHandlers().some(a => a.id === overId)) {
        const ur = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
        setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur));
      }
    }
  };

  const getHandlersForShift = (shift: string) => {
    return roster
      .filter(r => r.date === selectedDate && r.shift === shift)
      .map(r => handlers.find(a => a.id === r.handlerId))
      .filter(Boolean) as Handler[];
  };

  const getOffDutyHandlers = () => {
    const types = ['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'];
    return roster
      .filter(r => r.date === selectedDate && types.includes(r.shift))
      .map(r => ({ handler: handlers.find(a => a.id === r.handlerId), reason: r.shift }))
      .filter(item => item.handler) as { handler: Handler; reason: ShiftType }[];
  };

  const getUnassignedHandlers = () => {
    const assigned = roster.filter(r => r.date === selectedDate).map(r => r.handlerId);
    return handlers.filter(a => !assigned.includes(a.id));
  };

  const activeHandler = activeId ? handlers.find(a => a.id === activeId) : null;
  const totalOnShift = SHIFTS.reduce((acc, s) => acc + getHandlersForShift(s).length, 0);
  const totalOffDuty = getOffDutyHandlers().length;

  const navDate = (dir: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + dir);
    setSelectedDate(dt.toLocaleDateString('en-CA'));
  };

  const dayLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  }).toUpperCase();

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

        {/* ── Main card ────────────────────────────────────────────────── */}
        <div className={`
          flex-1 flex flex-col overflow-hidden mx-3 my-2
          bg-slate-900/80 backdrop-blur-xl
          border border-slate-700/60
          rounded-2xl shadow-2xl shadow-black/40
          ${isModalOpen || leaveOperation ? 'brightness-50' : ''}
          transition-all duration-300
        `}>

          {/* ── Topbar ─────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 shrink-0 bg-slate-800/50">
            {/* Left: title + date nav */}
            <div className="flex items-center gap-5">
              <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em] leading-none mb-0.5">Agent Roster</p>
                <h1 className="text-[15px] font-black text-white tracking-tight uppercase leading-none">Schedule</h1>
              </div>

              <div className="w-px h-8 bg-slate-700" />

              {/* Date nav */}
              <div className="flex items-center gap-2">
                <button onClick={() => navDate(-1)} className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <div className="relative">
                  <div className="px-4 py-1.5 bg-slate-700/40 rounded-lg border border-slate-600/50 cursor-pointer min-w-[160px] text-center">
                    <span className="text-[11px] font-black text-white uppercase tracking-widest">{dayLabel}</span>
                  </div>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full"
                  />
                </div>
                <button onClick={() => navDate(1)} className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Clocks */}
              <div className="hidden lg:flex items-center gap-1 bg-slate-800/60 rounded-lg border border-slate-700/50 overflow-hidden">
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

            {/* Right: stats + actions */}
            <div className="flex items-center gap-3">
              {/* Live stats */}
              <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                <div className="text-center">
                  <p className="text-[8px] text-slate-500 uppercase tracking-widest font-black leading-none">On Shift</p>
                  <p className="text-[16px] font-black text-white tabular-nums leading-none mt-0.5">{totalOnShift}</p>
                </div>
                <div className="w-px h-6 bg-slate-700" />
                <div className="text-center">
                  <p className="text-[8px] text-slate-500 uppercase tracking-widest font-black leading-none">Off Duty</p>
                  <p className="text-[16px] font-black text-slate-400 tabular-nums leading-none mt-0.5">{totalOffDuty}</p>
                </div>
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImportingRoster}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/60 border border-slate-600/50 text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
              >
                <Upload size={13} />
                <span className="hidden sm:inline">{isImportingRoster ? 'Importing…' : 'Import'}</span>
              </button>
              <input type="file" ref={fileInputRef} onChange={handleRosterFileChange} accept=".xlsx,.xls,.csv" className="hidden" />

              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-teal-500/20"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Register</span>
              </button>
            </div>
          </div>

          {/* ── Import status banner ────────────────────────────────────── */}
          {importStatus && (
            <div className={`mx-4 mt-3 px-4 py-2.5 rounded-lg flex items-center justify-between text-[11px] font-bold border shrink-0 ${
              importStatus.tone === 'success' ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' :
              importStatus.tone === 'warning' ? 'bg-amber-900/40 border-amber-700/50 text-amber-300' :
              'bg-red-900/40 border-red-700/50 text-red-300'
            }`}>
              <span>{importStatus.message}</span>
              <button onClick={() => setImportStatus(null)} className="opacity-60 hover:opacity-100 ml-4"><X size={13} /></button>
            </div>
          )}

          {/* ── Shift grid ──────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <div className="flex h-full min-w-[700px]" style={{ minHeight: '300px' }}>
                {SHIFTS.map((shift, idx) => {
                  const cfg = getShiftConfig(shift);
                  const shiftHandlers = getHandlersForShift(shift);
                  const isLast = idx === SHIFTS.length - 1;

                  return (
                    <div key={shift} className={`flex flex-col flex-1 min-w-0 ${!isLast ? 'border-r border-slate-700/50' : ''}`}>
                      {/* Column header */}
                      <div className={`${cfg.headerBg} px-3 py-2.5 border-b border-slate-700/60 shrink-0`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${cfg.accent} shadow-sm`} style={{ boxShadow: `0 0 6px ${cfg.accentHex}80` }} />
                            <div>
                              <p className="text-[8px] text-white/40 font-black uppercase tracking-widest leading-none">{cfg.label}</p>
                              <p className="text-[11px] text-white font-black uppercase tracking-wider leading-none mt-0.5">{shift}</p>
                            </div>
                          </div>
                          <span
                            className="text-[11px] font-black tabular-nums px-2 py-0.5 rounded-md"
                            style={{ background: `${cfg.accentHex}25`, color: cfg.accentHex }}
                          >
                            {shiftHandlers.length}
                          </span>
                        </div>
                      </div>

                      {/* Column body */}
                      <DroppableContainer id={shift} className={`flex-1 ${cfg.colBg} px-2 py-2`}>
                        <SortableContext id={shift} items={shiftHandlers.map(h => h.id)} strategy={verticalListSortingStrategy}>
                          <ul className="flex flex-col gap-1.5">
                            {shiftHandlers.slice(0, MAX_SHIFT_VISIBLE).map(handler => (
                              <SortableHandler
                                key={handler.id}
                                handler={handler}
                                shift={shift}
                                onShiftChange={updateShift}
                                onDelete={deleteHandlerGlobally}
                                shiftOptions={shiftPickerOptions}
                              />
                            ))}
                            {shiftHandlers.length === 0 && (
                              <li className="flex items-center justify-center h-10 rounded-lg border border-dashed border-white/10 mt-1">
                                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Empty</span>
                              </li>
                            )}
                          </ul>
                          {shiftHandlers.length > MAX_SHIFT_VISIBLE && (
                            <div className="mt-1.5 py-1.5 text-center text-[9px] font-black text-white/40 bg-white/5 rounded-lg border border-white/10">
                              +{shiftHandlers.length - MAX_SHIFT_VISIBLE} more
                            </div>
                          )}
                        </SortableContext>
                      </DroppableContainer>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Off Duty strip ──────────────────────────────────────── */}
            <div className="shrink-0 border-t border-slate-700/60 bg-slate-800/40">
              <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/30">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Leaves / Week Off</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-[9px] font-black text-slate-400">
                  {totalOffDuty} agents
                </span>
              </div>
              <DroppableContainer id="OFF_DUTY" className="px-4 py-2.5">
                <SortableContext id="OFF_DUTY" items={getOffDutyHandlers().map(i => i.handler.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-wrap gap-2 min-h-[28px]">
                    {getOffDutyHandlers().map(({ handler, reason }) => {
                      const lc = LEAVE_CONFIG[reason] ?? { label: reason, color: '#64748B', textColor: 'text-slate-300', borderColor: 'border-slate-600' };
                      return (
                        <SortableHandler
                          key={handler.id}
                          handler={handler}
                          shift={reason}
                          onShiftChange={updateShift}
                          onDelete={deleteHandlerGlobally}
                          shiftOptions={shiftPickerOptions}
                          compact
                        />
                      );
                    })}
                    {totalOffDuty === 0 && (
                      <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest self-center">No agents on leave today</p>
                    )}
                  </div>
                </SortableContext>
              </DroppableContainer>
            </div>
          </div>
        </div>

        {/* ── Drag Overlay ────────────────────────────────────────────────── */}
        <DragOverlay>
          {activeId && activeHandler && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-slate-700/90 backdrop-blur-xl border border-white/20 shadow-2xl w-48 scale-105">
              <GripVertical size={12} className="text-white/40" />
              <span className="text-[12px] font-semibold text-white truncate">{activeHandler.name}</span>
            </div>
          )}
        </DragOverlay>

        {/* Trash zones */}
        {activeId && (
          <>
            <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-16 h-24" id="TRASH" />
            <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-16 h-24" id="TRASH" />
          </>
        )}
      </DndContext>

      {/* ── Leave Confirmation Modal ─────────────────────────────────────── */}
      {leaveOperation && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setLeaveOperation(null)} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="w-10 h-10 bg-teal-500/10 rounded-xl flex items-center justify-center border border-teal-500/20">
                  <AlertCircle size={20} className="text-teal-400" />
                </div>
                <button onClick={() => setLeaveOperation(null)} className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
              <h3 className="text-lg font-black text-white mb-1">
                {leaveOperation.type === 'assign' ? 'Confirm Leave Assignment' : 'Remove From Leave?'}
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-5">
                {leaveOperation.type === 'assign' ? 'This handler will be marked as on leave' : 'Handler will be moved back to active shift'}
              </p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-3 py-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Handler</span>
                  <span className="text-[13px] font-black text-white">{handlers.find(a => a.id === leaveOperation.handlerId)?.name}</span>
                </div>
                {leaveOperation.type === 'assign' && (
                  <div className="flex items-center justify-between px-3 py-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Leave Type</span>
                    <span className="text-[13px] font-black text-teal-400">{leaveOperation.toShift}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Date</span>
                  <span className="text-[13px] font-black text-white">{dayLabel}</span>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setLeaveOperation(null)} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-800 transition-all">
                Cancel
              </button>
              <button onClick={handleLeaveConfirm} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-teal-500 hover:bg-teal-400 text-white transition-all shadow-lg shadow-teal-500/20">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Register Agent Modal ─────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="w-10 h-10 bg-teal-500/10 rounded-xl flex items-center justify-center border border-teal-500/20">
                  <Plus size={20} className="text-teal-400" />
                </div>
                <button onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
              <h3 className="text-lg font-black text-white mb-1">Register Agent</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-5">Add to roster</p>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1.5">Name</label>
                  <input
                    autoFocus
                    value={newAgentName}
                    onChange={e => setNewAgentName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddAgentConfirm()}
                    className="w-full px-3 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg text-white text-[13px] font-semibold focus:outline-none focus:border-teal-500/60 transition-colors placeholder:text-slate-600"
                    placeholder="Full name"
                  />
                </div>
                <div className="relative">
                  <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1.5">Initial Shift <span className="text-slate-600">(optional)</span></label>
                  <button
                    type="button"
                    onClick={() => setNewAgentShiftOpen(s => !s)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg text-left transition-colors hover:border-slate-600"
                  >
                    <span className={`text-[13px] font-semibold ${newAgentShift ? 'text-white' : 'text-slate-600'}`}>{newAgentShift || 'No shift assigned'}</span>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform ${newAgentShiftOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {newAgentShiftOpen && (
                    <div className="absolute z-50 mt-1 w-full max-h-52 overflow-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
                      <button type="button" className="w-full text-left px-3 py-2.5 text-[12px] text-slate-400 hover:bg-slate-700 transition-colors" onClick={() => { setNewAgentShift(''); setNewAgentShiftOpen(false); }}>
                        No shift assigned
                      </button>
                      {shiftPickerOptions.map(s => (
                        <button key={s} type="button" className="w-full text-left px-3 py-2.5 text-[12px] text-white hover:bg-slate-700 transition-colors font-medium" onClick={() => { setNewAgentShift(s); setNewAgentShiftOpen(false); }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-800 transition-all">
                Cancel
              </button>
              <button onClick={handleAddAgentConfirm} disabled={!newAgentName.trim()} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-teal-500 hover:bg-teal-400 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-all shadow-lg shadow-teal-500/20 disabled:shadow-none">
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RosterPage;

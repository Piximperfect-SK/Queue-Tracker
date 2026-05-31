import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MOCK_HANDLERS, SHIFTS, MOCK_ROSTER } from '../data/mockData';
import { GripVertical, Plus, X, Trash2, AlertCircle, Upload, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import type { Handler, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';
import { addLogForDate } from '../utils/logger';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ALL_SHIFT_TYPES: ShiftType[] = [
  '6AM-3PM','12PM-9PM','1PM-10PM','2PM-11PM','10PM-7AM',
  'WO','ML','PL','EL','UL','CO','MID-LEAVE'
];
const MAX_SHIFT_VISIBLE = 8;
type ImportFeedback = { message: string; tone: 'success' | 'warning' | 'error' };

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
        return `${decoded.y}-${String(decoded.m).padStart(2,'0')}-${String(decoded.d).padStart(2,'0')}`;
      }
    }
  }
  const formatted = normalizeCellValue(value);
  if (!formatted) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  const parsed = new Date(formatted);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  }
  return null;
};

const createAgentId = () => {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

// ─── Shift colour config (light mode) ────────────────────────────────────────
// Morning (6AM-3PM)        → Sky blue
// Afternoon (12PM-9, 1-10) → Yellow / Amber
// Evening (2PM-11PM)       → Orange
// Night (10PM-7AM)         → Indigo
const SHIFT_CONFIG: Record<string, {
  accentHex: string;
  label: string;
  headerBg: string;
  headerText: string;
  headerBorder: string;
  colBg: string;
  pillBg: string;
  pillText: string;
  pillBorder: string;
  dot: string;
  countBg: string;
  countText: string;
}> = {
  '6AM-3PM':  { accentHex:'#0284C7', label:'Morning',   headerBg:'bg-sky-600',    headerText:'text-white',     headerBorder:'border-sky-700',    colBg:'bg-sky-50/40',    pillBg:'bg-sky-100',    pillText:'text-sky-800',    pillBorder:'border-sky-200',    dot:'bg-sky-400',    countBg:'bg-sky-100',    countText:'text-sky-700' },
  '12PM-9PM': { accentHex:'#CA8A04', label:'Afternoon', headerBg:'bg-yellow-500', headerText:'text-white',     headerBorder:'border-yellow-600', colBg:'bg-yellow-50/40', pillBg:'bg-yellow-100', pillText:'text-yellow-800', pillBorder:'border-yellow-200', dot:'bg-yellow-400', countBg:'bg-yellow-100', countText:'text-yellow-700' },
  '1PM-10PM': { accentHex:'#D97706', label:'Afternoon', headerBg:'bg-amber-500',  headerText:'text-white',     headerBorder:'border-amber-600',  colBg:'bg-amber-50/40',  pillBg:'bg-amber-100',  pillText:'text-amber-800',  pillBorder:'border-amber-200',  dot:'bg-amber-400',  countBg:'bg-amber-100',  countText:'text-amber-700' },
  '2PM-11PM': { accentHex:'#EA580C', label:'Evening',   headerBg:'bg-orange-500', headerText:'text-white',     headerBorder:'border-orange-600', colBg:'bg-orange-50/40', pillBg:'bg-orange-100', pillText:'text-orange-800', pillBorder:'border-orange-200', dot:'bg-orange-400', countBg:'bg-orange-100', countText:'text-orange-700' },
  '10PM-7AM': { accentHex:'#4F46E5', label:'Night',     headerBg:'bg-indigo-700', headerText:'text-white',     headerBorder:'border-indigo-800', colBg:'bg-indigo-50/40', pillBg:'bg-indigo-100', pillText:'text-indigo-800', pillBorder:'border-indigo-200', dot:'bg-indigo-400', countBg:'bg-indigo-100', countText:'text-indigo-700' },
};
const getFallbackConfig = (shift: string) => ({
  accentHex:'#64748B', label: shift, headerBg:'bg-slate-500', headerText:'text-white', headerBorder:'border-slate-600',
  colBg:'bg-slate-50', pillBg:'bg-slate-100', pillText:'text-slate-700', pillBorder:'border-slate-200',
  dot:'bg-slate-400', countBg:'bg-slate-100', countText:'text-slate-600',
});
const getShiftConfig = (shift: string) => SHIFT_CONFIG[shift] ?? getFallbackConfig(shift);

const LEAVE_CONFIG: Record<string, { label:string; bg:string; text:string; border:string }> = {
  'WO':       { label:'Week Off',  bg:'bg-slate-100',  text:'text-slate-600',  border:'border-slate-200' },
  'ML':       { label:'Medical',   bg:'bg-pink-100',   text:'text-pink-700',   border:'border-pink-200'  },
  'PL':       { label:'Privilege', bg:'bg-rose-100',   text:'text-rose-700',   border:'border-rose-200'  },
  'EL':       { label:'Emergency', bg:'bg-red-100',    text:'text-red-700',    border:'border-red-200'   },
  'UL':       { label:'Unpaid',    bg:'bg-gray-100',   text:'text-gray-600',   border:'border-gray-200'  },
  'CO':       { label:'Comp-Off',  bg:'bg-emerald-100',text:'text-emerald-700',border:'border-emerald-200'},
  'MID-LEAVE':{ label:'Mid-Leave', bg:'bg-rose-100',   text:'text-rose-600',   border:'border-rose-100'  },
};
const getLeaveConfig = (shift: string) => LEAVE_CONFIG[shift] ?? { label:shift, bg:'bg-slate-100', text:'text-slate-600', border:'border-slate-200' };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BLUEPRINT_CACHE_KEY = 'roster_blueprint';
const mergeRosterEntries = (base: RosterEntry[], additions: RosterEntry[]) => {
  const merged = [...base];
  additions.forEach(e => {
    const idx = merged.findIndex(r => r.handlerId === e.handlerId && r.date === e.date);
    if (idx > -1) merged[idx] = e; else merged.push(e);
  });
  return merged;
};
const loadBlueprint = (): Record<string, RosterEntry[]> => {
  try { return JSON.parse(localStorage.getItem(BLUEPRINT_CACHE_KEY) || '{}'); } catch { return {}; }
};
const applyBlueprint = (base: RosterEntry[]) => {
  const entries = Object.values(loadBlueprint()).flat();
  return entries.length ? mergeRosterEntries(base, entries) : base;
};

// ─── DroppableContainer ──────────────────────────────────────────────────────
const DroppableContainer: React.FC<{ id: string; children: React.ReactNode; className?: string }> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className??''} ${isOver ? 'ring-2 ring-inset ring-slate-400/30 bg-slate-50' : ''} transition-all duration-150`}>
      {children}
    </div>
  );
};

// ─── SortableHandler pill ────────────────────────────────────────────────────
interface SortableHandlerProps {
  handler: Handler;
  shift: string;
  onShiftChange: (id: string, shift: ShiftType) => void;
  onDelete: (id: string) => void;
  shiftOptions: ShiftType[];
  compact?: boolean;
}

const SortableHandler: React.FC<SortableHandlerProps> = ({ handler, shift, onShiftChange, onDelete, shiftOptions, compact }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: handler.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.2 : 1, zIndex: isDragging ? 50 : 1 };
  const cfg = getShiftConfig(shift);
  const lc = getLeaveConfig(shift);
  // For leave types, use leave config; otherwise shift config
  const isLeave = ['WO','ML','PL','EL','UL','CO','MID-LEAVE'].includes(shift);
  const bg = isLeave ? lc.bg : cfg.pillBg;
  const text = isLeave ? lc.text : cfg.pillText;
  const border = isLeave ? lc.border : cfg.pillBorder;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-center gap-2 rounded-lg border transition-all cursor-default
        ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}
        ${bg} ${border} border hover:shadow-sm active:scale-[0.98]`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 shrink-0 transition-colors">
        <GripVertical size={12} />
      </div>
      {handler.isQH && <Shield size={10} className="text-amber-500 shrink-0" />}
      <span className={`flex-1 font-semibold truncate ${text} ${compact ? 'text-[11px]' : 'text-[12px]'} leading-none`}>
        {handler.name}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <select
          value={shift}
          onChange={e => onShiftChange(handler.id, e.target.value as ShiftType)}
          className="text-[8px] font-black bg-white/80 text-slate-600 px-1 py-0.5 rounded border border-slate-200 focus:ring-0 outline-none cursor-pointer uppercase tracking-wider max-w-[60px]"
        >
          {shiftOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={e => { e.stopPropagation(); onDelete(handler.id); }}
          className="p-1 rounded text-red-400 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </li>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────
interface RosterPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const RosterPage: React.FC<RosterPageProps> = ({ selectedDate, setSelectedDate }) => {
  const [handlers, setHandlers] = useState<Handler[]>(() => {
    const s = localStorage.getItem('handlers'); return s ? JSON.parse(s) : MOCK_HANDLERS;
  });
  const [roster, setRoster] = useState<RosterEntry[]>(() => {
    const s = localStorage.getItem('roster');
    return applyBlueprint(s ? JSON.parse(s) : MOCK_ROSTER);
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentShift, setNewAgentShift] = useState<ShiftType | ''>('');
  const [newAgentShiftOpen, setNewAgentShiftOpen] = useState(false);
  const [leaveOperation, setLeaveOperation] = useState<{
    type: 'assign' | 'remove'; handlerId: string; fromShift?: ShiftType; toShift?: ShiftType | 'UNASSIGNED';
  } | null>(null);
  const [importStatus, setImportStatus] = useState<ImportFeedback | null>(null);
  const [isImportingRoster, setIsImportingRoster] = useState(false);
  const [times, setTimes] = useState({ ist: '', uk: '' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Screenshot import state
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [isParsingScreenshot, setIsParsingScreenshot] = useState(false);
  const [screenshotParseResult, setScreenshotParseResult] = useState<{
    entries: RosterEntry[];
    newHandlers: Handler[];
    summary: string;
  } | null>(null);

  useEffect(() => {
    const update = () => {
      const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
      setTimes({ ist: fmt('Asia/Kolkata'), uk: fmt('Europe/London') });
    };
    update(); const id = setInterval(update, 10000); return () => clearInterval(id);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const availableShifts = useMemo(() => {
    const s = new Set(SHIFTS);
    roster.filter(e => e.date === selectedDate).forEach(e => s.add(e.shift));
    return Array.from(s);
  }, [roster, selectedDate]);

  const shiftPickerOptions = useMemo(() =>
    Array.from(new Set([...ALL_SHIFT_TYPES, ...availableShifts])),
  [availableShifts]);

  useEffect(() => {
    const onHandlers = (d: Handler[]) => { if (d) { setHandlers(d); localStorage.setItem('handlers', JSON.stringify(d)); } };
    const onRoster   = (d: RosterEntry[]) => { if (d) { const m = applyBlueprint(d); setRoster(m); localStorage.setItem('roster', JSON.stringify(m)); } };
    const onInit = (db: any) => {
      if (!db) return;
      const h = db.handlers || db.agents;
      if (Array.isArray(h)) { setHandlers(h); localStorage.setItem('handlers', JSON.stringify(h)); }
      if (Array.isArray(db.roster)) { const m = applyBlueprint(db.roster); setRoster(m); localStorage.setItem('roster', JSON.stringify(m)); }
      if (db.logs) saveLogsFromServer(db.logs);
    };
    socket.on('handlers_updated', onHandlers);
    socket.on('roster_updated', onRoster);
    socket.on('log_added', ({ dateStr, logEntry }) => saveSingleLogFromServer(dateStr, logEntry));
    socket.on('init', onInit);
    if (socket.connected) socket.emit('get_initial_data');
    return () => {
      socket.off('handlers_updated', onHandlers);
      socket.off('roster_updated', onRoster);
      socket.off('log_added');
      socket.off('init', onInit);
    };
  }, []);

  const firstNavRef = useRef(true);
  useEffect(() => {
    if (firstNavRef.current) { firstNavRef.current = false; return; }
    addLogForDate(selectedDate, 'NAVIGATE', `Visited ${selectedDate}`);
    addLog('NAVIGATE', `Visited ${selectedDate}`);
  }, [selectedDate]);

  const LEAVE_TYPES = ['EL','PL','UL','MID-LEAVE','WO','ML','CO'];

  const updateShift = (handlerId: string, shift: ShiftType) => {
    if (LEAVE_TYPES.includes(shift)) { setLeaveOperation({ type: 'assign', handlerId, toShift: shift }); return; }
    executeShiftUpdate(handlerId, shift);
  };

  const executeShiftUpdate = (handlerId: string, shift: ShiftType) => {
    const handler = handlers.find(a => a.id === handlerId);
    const updated = [...roster];
    const idx = updated.findIndex(r => r.handlerId === handlerId && r.date === selectedDate);
    const oldShift = idx > -1 ? updated[idx].shift : 'Unassigned';
    if (idx > -1) updated[idx] = { ...updated[idx], shift };
    else updated.push({ handlerId, date: selectedDate, shift });
    setRoster(updated); localStorage.setItem('roster', JSON.stringify(updated)); syncData.updateRoster(updated);
    addLog('Update Shift', `${handler?.name || handlerId}: ${oldShift} -> ${shift} (Date: ${selectedDate})`);
  };

  function deleteHandlerGlobally(handlerId: string) {
    const h = handlers.find(a => a.id === handlerId);
    const uh = handlers.filter(a => a.id !== handlerId);
    const ur = roster.filter(r => r.handlerId !== handlerId);
    setHandlers(uh); setRoster(ur);
    localStorage.setItem('handlers', JSON.stringify(uh)); localStorage.setItem('roster', JSON.stringify(ur));
    syncData.updateHandlers(uh); syncData.updateRoster(ur);
    addLog('Delete Agent', `Permanently deleted handler: ${h?.name || handlerId}`, 'negative');
  }

  const handleRosterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    importRosterFromFile(file); e.target.value = '';
  };

  const importRosterFromFile = async (file: File) => {
    setImportStatus(null); setIsImportingRoster(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) { setImportStatus({ message: 'No sheets found.', tone: 'error' }); return; }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
      if (!rows.length) { setImportStatus({ message: 'No rows found.', tone: 'error' }); return; }

      const newHandlers: Handler[] = [];
      const parsedEntries: RosterEntry[] = [];
      const rowErrors: string[] = [];
      const lookup = new Map<string, string>();
      handlers.forEach(h => lookup.set(h.name.trim().toLowerCase(), h.id));

      const matchKey = (key: string, req: string[], forb: string[] = []) => {
        const k = key.trim().toLowerCase();
        return req.every(t => k.includes(t)) && !forb.some(t => k.includes(t));
      };

      rows.forEach((row, ri) => {
        const entries = Object.entries(row);
        if (entries.every(([, v]) => normalizeCellValue(v) === '')) return;
        const hCell = entries.find(([k]) => matchKey(k,['agent'])) ?? entries.find(([k]) => matchKey(k,['handler'])) ?? entries.find(([k]) => matchKey(k,['name'],['shift']));
        const sCell = entries.find(([k]) => matchKey(k,['shift'])) ?? entries.find(([k]) => matchKey(k,['status']));
        const dCell = entries.find(([k]) => matchKey(k,['date'])) ?? entries.find(([k]) => matchKey(k,['day']));

        const name = normalizeCellValue(hCell?.[1]);
        const rawShift = normalizeCellValue(sCell?.[1]);
        const date = parseExcelDate(dCell?.[1]);
        const label = `Row ${ri+2}`;

        if (!name)    { rowErrors.push(`${label}: name missing`);  return; }
        if (!date)    { rowErrors.push(`${label}: invalid date`);   return; }
        if (!rawShift){ rowErrors.push(`${label}: shift missing`);  return; }

        let sv = rawShift.toUpperCase().replace(/\s+/g,'');
        if (sv==='OFF'||sv==='WEEKOFF') sv='WO';
        const matched = ALL_SHIFT_TYPES.find(s => s.toUpperCase().replace(/\s+/g,'') === sv);
        if (matched) sv = matched;

        const key = name.toLowerCase();
        let hid = lookup.get(key);
        if (!hid) { hid = createAgentId(); lookup.set(key, hid); newHandlers.push({ id: hid, name, isQH: false }); }
        parsedEntries.push({ handlerId: hid, date, shift: sv });
      });

      if (!parsedEntries.length) { setImportStatus({ message: 'No valid rows.', tone: 'error' }); return; }

      const merged = mergeRosterEntries(roster, parsedEntries);
      setRoster(merged); localStorage.setItem('roster', JSON.stringify(merged)); syncData.updateRoster(merged);
      if (newHandlers.length) {
        const uh = [...handlers, ...newHandlers];
        setHandlers(uh); localStorage.setItem('handlers', JSON.stringify(uh)); syncData.updateHandlers(uh);
      }
      const dates = parsedEntries.map(e => e.date).sort();
      if (dates.length) setSelectedDate(dates[0]);
      const tone: ImportFeedback['tone'] = rowErrors.length ? 'warning' : 'success';
      setImportStatus({ message: `Imported ${parsedEntries.length} row(s).${newHandlers.length?` +${newHandlers.length} new.`:''}${rowErrors.length?` (${rowErrors.length} skipped)`:''}`, tone });
      addLog('Import Roster', `Imported ${parsedEntries.length} rows from ${file.name}`, 'positive');
    } catch (err) {
      setImportStatus({ message: `Import failed: ${err instanceof Error ? err.message : 'Unknown'}`, tone: 'error' });
    } finally { setIsImportingRoster(false); }
  };


  // ── Screenshot Import ────────────────────────────────────────────────────
  const handleScreenshotFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setScreenshotPreview(dataUrl);
      // Extract pure base64 (strip data:image/...;base64, prefix)
      setScreenshotBase64(dataUrl.split(',')[1]);
      setScreenshotParseResult(null);
      setIsScreenshotModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const TIME_TO_SHIFT: [RegExp, ShiftType][] = [
    [/6.?00\s*[Aa][Mm].*3.?00\s*[Pp][Mm]/,  '6AM-3PM' ],
    [/12.?00\s*[Pp][Mm].*9.?00\s*[Pp][Mm]/, '12PM-9PM'],
    [/1.?00\s*[Pp][Mm].*10.?00\s*[Pp][Mm]/, '1PM-10PM'],
    [/2.?00\s*[Pp][Mm].*11.?00\s*[Pp][Mm]/, '2PM-11PM'],
    [/10.?00\s*[Pp][Mm].*7.?00\s*[Aa][Mm]/, '10PM-7AM'],
    [/9.?00\s*[Pp][Mm].*6.?00\s*[Aa][Mm]/,  '10PM-7AM'],
  ];

  const parseShiftFromText = (text: string): ShiftType => {
    const t = text.trim().toUpperCase();
    if (!t || t === 'WO' || t === 'WEEK OFF' || t === 'WEEKOFF') return 'WO';
    if (t === 'PL' || t === 'PRIVILEGE LEAVE') return 'PL';
    if (t === 'ML' || t === 'MEDICAL LEAVE')   return 'ML';
    if (t === 'EL' || t === 'EMERGENCY LEAVE') return 'EL';
    if (t === 'UL' || t === 'UNPAID LEAVE')    return 'UL';
    if (t === 'CO' || t === 'COMP OFF' || t === 'COMPENSATORY') return 'CO';
    if (t === 'MID-LEAVE' || t === 'MID LEAVE') return 'MID-LEAVE';
    for (const [regex, shift] of TIME_TO_SHIFT) {
      if (regex.test(text)) return shift;
    }
    return 'WO';
  };

  const parseScreenshotWithAI = async () => {
    if (!screenshotBase64) return;
    setIsParsingScreenshot(true);
    setScreenshotParseResult(null);
    try {
      const prompt = `You are a roster data extractor. Analyse this roster/schedule screenshot carefully.

Extract ALL data as a JSON object with this exact structure:
{
  "dates": ["YYYY-MM-DD", ...],
  "roster": [
    {
      "name": "Agent Full Name",
      "entries": [
        { "date": "YYYY-MM-DD", "shift": "raw cell text exactly as shown" },
        ...
      ]
    },
    ...
  ]
}

Rules:
- dates array = all date columns found in the table header, converted to YYYY-MM-DD
- For each agent row, include one entry per date column
- shift = copy the cell text EXACTLY as shown (e.g. "06:00 AM to 03:00 PM", "WO", "PL", "CO", "01:00 PM to 10:00 PM")
- If a cell is blank or truly empty, use "WO"
- Do NOT skip any agent or any date
- Return ONLY the raw JSON, no markdown, no explanation, no code fences`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 }
              },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      const data = await response.json();
      const rawText = data.content?.find((b: any) => b.type === 'text')?.text ?? '';

      // Strip potential markdown fences
      const jsonText = rawText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonText);

      // Build handler lookup
      const lookup = new Map<string, string>();
      handlers.forEach(h => lookup.set(h.name.trim().toLowerCase(), h.id));

      const newHandlers: Handler[] = [];
      const entries: RosterEntry[] = [];

      for (const agentRow of parsed.roster) {
        const name = agentRow.name?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        let hid = lookup.get(key);
        if (!hid) {
          hid = createAgentId();
          lookup.set(key, hid);
          newHandlers.push({ id: hid, name, isQH: false });
        }
        for (const entry of agentRow.entries) {
          const shift = parseShiftFromText(entry.shift ?? '');
          entries.push({ handlerId: hid, date: entry.date, shift });
        }
      }

      const agentCount = parsed.roster?.length ?? 0;
      const dateCount = parsed.dates?.length ?? 0;
      setScreenshotParseResult({
        entries,
        newHandlers,
        summary: `Found ${agentCount} agents × ${dateCount} dates = ${entries.length} roster entries.${newHandlers.length ? ` ${newHandlers.length} new handler(s) will be created.` : ''}`
      });
    } catch (err) {
      setImportStatus({ message: `Screenshot parse failed: ${err instanceof Error ? err.message : 'Unknown error'}`, tone: 'error' });
      setIsScreenshotModalOpen(false);
    } finally {
      setIsParsingScreenshot(false);
    }
  };

  const applyScreenshotImport = () => {
    if (!screenshotParseResult) return;
    const { entries, newHandlers } = screenshotParseResult;
    const merged = mergeRosterEntries(roster, entries);
    setRoster(merged);
    localStorage.setItem('roster', JSON.stringify(merged));
    syncData.updateRoster(merged);
    if (newHandlers.length) {
      const uh = [...handlers, ...newHandlers];
      setHandlers(uh);
      localStorage.setItem('handlers', JSON.stringify(uh));
      syncData.updateHandlers(uh);
    }
    // Navigate to first date in the import
    const dates = [...new Set(entries.map(e => e.date))].sort();
    if (dates.length) setSelectedDate(dates[0]);
    addLog('Import Roster', `Screenshot import: ${entries.length} entries across ${[...new Set(entries.map(e=>e.date))].length} dates`, 'positive');
    setImportStatus({ message: screenshotParseResult.summary.replace('Found','Imported'), tone: 'success' });
    setIsScreenshotModalOpen(false);
    setScreenshotPreview(null);
    setScreenshotBase64(null);
    setScreenshotParseResult(null);
  };


  const handleLeaveConfirm = () => {
    if (!leaveOperation) return;
    if (leaveOperation.type === 'assign' && leaveOperation.toShift)
      executeShiftUpdate(leaveOperation.handlerId, leaveOperation.toShift as ShiftType);
    if (leaveOperation.type === 'remove') {
      const to = leaveOperation.toShift;
      if (to === 'UNASSIGNED') {
        const ur = roster.filter(r => !(r.handlerId === leaveOperation.handlerId && r.date === selectedDate));
        setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur)); syncData.updateRoster(ur);
        const h = handlers.find(a => a.id === leaveOperation.handlerId);
        addLog('Update Shift', `${h?.name}: ${leaveOperation.fromShift} -> Unassigned`);
      } else if (to) executeShiftUpdate(leaveOperation.handlerId, to as ShiftType);
    }
    setLeaveOperation(null);
  };

  const handleAddAgentConfirm = () => {
    const name = newAgentName.trim(); if (!name) return;
    const id = createAgentId();
    const uh = [...handlers, { id, name, isQH: false }];
    setHandlers(uh); localStorage.setItem('handlers', JSON.stringify(uh)); syncData.updateHandlers(uh);
    if (newAgentShift) {
      const ur = mergeRosterEntries(roster, [{ handlerId: id, date: selectedDate, shift: newAgentShift }]);
      setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur)); syncData.updateRoster(ur);
      addLog('Register Agent', `Registered: ${name} → ${newAgentShift} on ${selectedDate}`, 'positive');
    } else { addLog('Register Agent', `Registered: ${name}`, 'positive'); }
    setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false);
  };

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveId(null); if (!over) return;
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
      if (overId === 'UNASSIGNED') { setLeaveOperation({ type: 'remove', handlerId, fromShift: currentEntry.shift, toShift: 'UNASSIGNED' }); return; }
    }

    if (availableShifts.includes(overId as ShiftType)) updateShift(handlerId, overId as ShiftType);
    else if (overId === 'OFF_DUTY') updateShift(handlerId, 'WO');
    else if (overId === 'UNASSIGNED') {
      const ur = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
      setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur));
    } else if (overId === 'TRASH' && isHorizontal) deleteHandlerGlobally(handlerId);
    else {
      const overEntry = roster.find(r => r.handlerId === overId && r.date === selectedDate);
      if (overEntry) updateShift(handlerId, overEntry.shift);
      else if (getUnassignedHandlers().some(a => a.id === overId)) {
        const ur = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
        setRoster(ur); localStorage.setItem('roster', JSON.stringify(ur));
      }
    }
  };

  const getHandlersForShift = (shift: string) =>
    roster.filter(r => r.date === selectedDate && r.shift === shift)
      .map(r => handlers.find(a => a.id === r.handlerId)).filter(Boolean) as Handler[];

  const getOffDutyHandlers = () => {
    const types = ['WO','ML','PL','EL','UL','CO','MID-LEAVE'];
    return roster.filter(r => r.date === selectedDate && types.includes(r.shift))
      .map(r => ({ handler: handlers.find(a => a.id === r.handlerId), reason: r.shift }))
      .filter(i => i.handler) as { handler: Handler; reason: ShiftType }[];
  };

  const getUnassignedHandlers = () => {
    const assigned = roster.filter(r => r.date === selectedDate).map(r => r.handlerId);
    return handlers.filter(a => !assigned.includes(a.id));
  };

  const activeHandler = activeId ? handlers.find(a => a.id === activeId) : null;
  const totalOnShift = SHIFTS.reduce((acc, s) => acc + getHandlersForShift(s).length, 0);
  const totalOffDuty = getOffDutyHandlers().length;

  const navDate = (dir: number) => {
    const [y,m,d] = selectedDate.split('-').map(Number);
    const dt = new Date(y,m-1,d); dt.setDate(dt.getDate()+dir);
    setSelectedDate(dt.toLocaleDateString('en-CA'));
  };

  const dayLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  }).toUpperCase();

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

        {/* Main card */}
        <div className={`
          flex-1 flex flex-col overflow-hidden mx-3 my-2
          bg-white border border-slate-200 rounded-2xl shadow-sm
          ${isModalOpen || leaveOperation ? 'brightness-50' : ''}
          transition-all duration-300
        `}>

          {/* Topbar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0 bg-white rounded-t-2xl">
            {/* Left */}
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.25em] leading-none mb-0.5">Agent Roster</p>
                <h1 className="text-[15px] font-black text-slate-900 tracking-tight uppercase leading-none">Schedule</h1>
              </div>

              <div className="w-px h-8 bg-slate-200" />

              {/* Date nav */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => navDate(-1)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <div className="relative">
                  <div className="px-4 py-1.5 bg-white rounded-lg border border-slate-200 cursor-pointer min-w-[168px] text-center shadow-sm">
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">{dayLabel}</span>
                  </div>
                  <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
                </div>
                <button onClick={() => navDate(1)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Clocks */}
              <div className="hidden lg:flex items-center gap-0 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden shadow-sm">
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

            {/* Right */}
            <div className="flex items-center gap-3">
              {/* Stats */}
              <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl border border-slate-200 shadow-sm">
                <div className="text-center">
                  <p className="text-[7.5px] text-slate-400 uppercase tracking-widest font-black leading-none">On Shift</p>
                  <p className="text-[16px] font-black text-slate-900 tabular-nums leading-none mt-0.5">{totalOnShift}</p>
                </div>
                <div className="w-px h-6 bg-slate-200" />
                <div className="text-center">
                  <p className="text-[7.5px] text-slate-400 uppercase tracking-widest font-black leading-none">Off Duty</p>
                  <p className="text-[16px] font-black text-slate-500 tabular-nums leading-none mt-0.5">{totalOffDuty}</p>
                </div>
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImportingRoster}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm disabled:opacity-40"
              >
                <Upload size={13} />
                <span className="hidden sm:inline">{isImportingRoster ? 'Importing…' : 'Import'}</span>
              </button>
              <input type="file" ref={fileInputRef} onChange={handleRosterFileChange} accept=".xlsx,.xls,.csv" className="hidden" />

              {/* Screenshot import button */}
              <button
                onClick={() => screenshotInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 hover:text-indigo-800 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                title="Import from screenshot"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="hidden sm:inline">AI Scan</span>
              </button>
              <input type="file" ref={screenshotInputRef} onChange={handleScreenshotFileChange} accept="image/*" className="hidden" />

              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-black text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-md"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Register</span>
              </button>
            </div>
          </div>

          {/* Import banner */}
          {importStatus && (
            <div className={`mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center justify-between text-[11px] font-bold border shrink-0 ${
              importStatus.tone === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              importStatus.tone === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' :
              'bg-red-50 border-red-200 text-red-700'
            }`}>
              <span>{importStatus.message}</span>
              <button onClick={() => setImportStatus(null)} className="opacity-50 hover:opacity-100 ml-4"><X size={13} /></button>
            </div>
          )}

          {/* Shift grid */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <div className="flex h-full min-w-[700px]" style={{ minHeight: '300px' }}>
                {SHIFTS.map((shift, idx) => {
                  const cfg = getShiftConfig(shift);
                  const shiftHandlers = getHandlersForShift(shift);
                  const isLast = idx === SHIFTS.length - 1;

                  return (
                    <div key={shift} className={`flex flex-col flex-1 min-w-0 ${!isLast ? 'border-r border-slate-200' : ''}`}>
                      {/* Column header */}
                      <div className={`${cfg.headerBg} px-3 py-2.5 border-b border-slate-200 shrink-0`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[8px] text-white/70 font-black uppercase tracking-widest leading-none">{cfg.label}</p>
                            <p className="text-[12px] text-white font-black uppercase tracking-wide leading-none mt-0.5">{shift}</p>
                          </div>
                          <span className="text-[12px] font-black px-2 py-0.5 rounded-md bg-white/20 text-white tabular-nums">
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
                              <li className="flex items-center justify-center h-10 rounded-lg border-2 border-dashed border-slate-200 mt-1">
                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Empty</span>
                              </li>
                            )}
                          </ul>
                          {shiftHandlers.length > MAX_SHIFT_VISIBLE && (
                            <div className="mt-1.5 py-1.5 text-center text-[9px] font-black text-slate-500 bg-white/60 rounded-lg border border-slate-200">
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

            {/* Off Duty strip */}
            <div className="shrink-0 border-t border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Leaves / Week Off</span>
                <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[9px] font-black text-slate-500 shadow-sm">
                  {totalOffDuty} agents
                </span>
              </div>
              <DroppableContainer id="OFF_DUTY" className="px-4 py-2.5">
                <SortableContext id="OFF_DUTY" items={getOffDutyHandlers().map(i => i.handler.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-wrap gap-2 min-h-[28px]">
                    {getOffDutyHandlers().map(({ handler, reason }) => (
                      <SortableHandler
                        key={handler.id}
                        handler={handler}
                        shift={reason}
                        onShiftChange={updateShift}
                        onDelete={deleteHandlerGlobally}
                        shiftOptions={shiftPickerOptions}
                        compact
                      />
                    ))}
                    {totalOffDuty === 0 && (
                      <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest self-center">
                        No agents on leave today
                      </p>
                    )}
                  </div>
                </SortableContext>
              </DroppableContainer>
            </div>
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeId && activeHandler && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white border border-slate-200 shadow-2xl w-48 scale-105">
              <GripVertical size={12} className="text-slate-400" />
              <span className="text-[12px] font-semibold text-slate-800 truncate">{activeHandler.name}</span>
            </div>
          )}
        </DragOverlay>

        {activeId && (
          <>
            <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-16 h-24" id="TRASH" />
            <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-16 h-24" id="TRASH" />
          </>
        )}
      </DndContext>

      {/* Leave Confirmation Modal */}
      {leaveOperation && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setLeaveOperation(null)} />
          <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <AlertCircle size={20} className="text-slate-600" />
                </div>
                <button onClick={() => setLeaveOperation(null)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-1">
                {leaveOperation.type === 'assign' ? 'Confirm Leave Assignment' : 'Remove From Leave?'}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-5">
                {leaveOperation.type === 'assign' ? 'Mark handler as on leave' : 'Move handler back to active shift'}
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Handler', value: handlers.find(a => a.id === leaveOperation.handlerId)?.name },
                  ...(leaveOperation.type === 'assign' ? [{ label: 'Leave Type', value: leaveOperation.toShift }] : []),
                  { label: 'Date', value: dayLabel },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">{label}</span>
                    <span className="text-[13px] font-black text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setLeaveOperation(null)} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-all">Cancel</button>
              <button onClick={handleLeaveConfirm} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-slate-900 hover:bg-black text-white transition-all shadow-md">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Register Agent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} />
          <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <Plus size={20} className="text-slate-700" />
                </div>
                <button onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-1">Register Agent</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-5">Add to roster</p>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1.5">Name</label>
                  <input
                    autoFocus
                    value={newAgentName}
                    onChange={e => setNewAgentName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddAgentConfirm()}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-slate-300 transition-all placeholder:text-slate-300"
                    placeholder="Full name"
                  />
                </div>

                <div className="relative">
                  <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1.5">
                    Initial Shift <span className="text-slate-300">(optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewAgentShiftOpen(s => !s)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-left hover:bg-white transition-colors"
                  >
                    <span className={`text-[13px] font-semibold ${newAgentShift ? 'text-slate-900' : 'text-slate-400'}`}>
                      {newAgentShift || 'No shift assigned'}
                    </span>
                    <ChevronRight size={14} className={`text-slate-400 transition-transform ${newAgentShiftOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {newAgentShiftOpen && (
                    <div className="absolute z-50 mt-1 w-full max-h-52 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      <button type="button" className="w-full text-left px-3 py-2.5 text-[12px] text-slate-400 hover:bg-slate-50 transition-colors border-b border-slate-100" onClick={() => { setNewAgentShift(''); setNewAgentShiftOpen(false); }}>
                        No shift assigned
                      </button>
                      {shiftPickerOptions.map(s => (
                        <button key={s} type="button" className="w-full text-left px-3 py-2.5 text-[12px] text-slate-700 hover:bg-slate-50 transition-colors font-semibold border-b border-slate-50 last:border-0" onClick={() => { setNewAgentShift(s); setNewAgentShiftOpen(false); }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => { setNewAgentName(''); setNewAgentShift(''); setIsModalOpen(false); }} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-all">Cancel</button>
              <button onClick={handleAddAgentConfirm} disabled={!newAgentName.trim()} className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-slate-900 hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 text-white transition-all shadow-md">Register</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Screenshot / AI Scan Modal ─────────────────────────────────────── */}
      {isScreenshotModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setIsScreenshotModalOpen(false); setScreenshotPreview(null); setScreenshotBase64(null); setScreenshotParseResult(null); }} />
          <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
                <div>
                  <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest leading-none">AI Roster Scan</h3>
                  <p className="text-[8px] text-slate-400 uppercase tracking-widest mt-0.5">Claude reads the screenshot and builds the roster</p>
                </div>
              </div>
              <button onClick={() => { setIsScreenshotModalOpen(false); setScreenshotPreview(null); setScreenshotBase64(null); setScreenshotParseResult(null); }} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Preview */}
              {screenshotPreview && (
                <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm max-h-52">
                  <img src={screenshotPreview} alt="Roster screenshot" className="w-full object-contain" />
                </div>
              )}

              {/* Parse result summary */}
              {screenshotParseResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-black text-emerald-700 uppercase tracking-wider mb-1">✓ Parse Complete</p>
                  <p className="text-[12px] text-emerald-800 font-semibold">{screenshotParseResult.summary}</p>
                </div>
              )}

              {/* Steps guide */}
              {!screenshotParseResult && !isParsingScreenshot && (
                <div className="space-y-2">
                  {[
                    { n: '1', text: 'Screenshot uploaded — Claude will analyse the full roster table' },
                    { n: '2', text: 'Agent names, dates and shift times will be automatically detected' },
                    { n: '3', text: 'Review the summary, then click Apply to update all roster days at once' },
                  ].map(({ n, text }) => (
                    <div key={n} className="flex items-start gap-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                      <p className="text-[11px] text-slate-600 font-medium leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Parsing spinner */}
              {isParsingScreenshot && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="w-10 h-10 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Claude is reading the roster…</p>
                  <p className="text-[10px] text-slate-400">Extracting agents, dates and shifts</p>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setIsScreenshotModalOpen(false); setScreenshotPreview(null); setScreenshotBase64(null); setScreenshotParseResult(null); }}
                className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-all"
              >
                Cancel
              </button>
              {!screenshotParseResult ? (
                <button
                  onClick={parseScreenshotWithAI}
                  disabled={isParsingScreenshot || !screenshotBase64}
                  className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white transition-all shadow-md"
                >
                  {isParsingScreenshot ? 'Scanning…' : 'Scan with AI'}
                </button>
              ) : (
                <button
                  onClick={applyScreenshotImport}
                  className="flex-1 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-md"
                >
                  ✓ Apply to Roster
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default RosterPage;

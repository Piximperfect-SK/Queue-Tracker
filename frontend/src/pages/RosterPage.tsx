import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MOCK_HANDLERS, SHIFTS, MOCK_ROSTER } from '../data/mockData';
import { Calendar as CalendarIcon, GripVertical, Plus, X, Trash2, AlertCircle } from 'lucide-react';
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
  
  // If it's already YYYY-MM-DD, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  
  const parsed = new Date(formatted);
  if (!Number.isNaN(parsed.getTime())) {
    // Use local date components to avoid timezone shifts (e.g. midnight GMT+1 becoming previous day in UTC)
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

const getShiftColor = (shift: string) => {
  switch (shift) {
    case '6AM-3PM': return { bg: 'bg-blue-600', text: 'text-blue-700', light: 'bg-blue-50', border: 'border-blue-200', card: 'bg-blue-50' };
    case '12PM-9PM': return { bg: 'bg-yellow-400', text: 'text-yellow-600', light: 'bg-yellow-50', border: 'border-yellow-200', card: 'bg-yellow-50' };
    case '1PM-10PM': return { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-50', border: 'border-orange-200', card: 'bg-orange-50' };
    case '2PM-11PM': return { bg: 'bg-orange-700', text: 'text-orange-700', light: 'bg-orange-50', border: 'border-orange-200', card: 'bg-orange-50' };
    case '10PM-7AM': return { bg: 'bg-blue-900', text: 'text-blue-900', light: 'bg-blue-50', border: 'border-blue-300', card: 'bg-blue-50' };
    case 'WO': return { bg: 'bg-slate-400', text: 'text-slate-500', light: 'bg-slate-50', border: 'border-slate-200', card: 'bg-slate-50' };
    case 'ML': return { bg: 'bg-pink-500', text: 'text-pink-600', light: 'bg-pink-50', border: 'border-pink-200', card: 'bg-pink-50' };
    case 'PL': return { bg: 'bg-rose-500', text: 'text-rose-600', light: 'bg-rose-50', border: 'border-rose-200', card: 'bg-rose-50' };
    case 'EL': return { bg: 'bg-red-600', text: 'text-red-700', light: 'bg-red-50', border: 'border-red-200', card: 'bg-red-50' };
    case 'UL': return { bg: 'bg-gray-500', text: 'text-gray-600', light: 'bg-gray-50', border: 'border-gray-200', card: 'bg-gray-50' };
    case 'CO': return { bg: 'bg-emerald-600', text: 'text-emerald-700', light: 'bg-emerald-50', border: 'border-emerald-200', card: 'bg-emerald-50' };
    case 'MID-LEAVE': return { bg: 'bg-rose-600', text: 'text-rose-600', light: 'bg-rose-50', border: 'border-rose-100', card: 'bg-rose-50' };
    default: return { bg: 'bg-slate-500', text: 'text-slate-500', light: 'bg-slate-50', border: 'border-slate-200', card: 'bg-slate-50' };
  }
};

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
  try {
    return JSON.parse(localStorage.getItem(BLUEPRINT_CACHE_KEY) || '{}');
  } catch (error) {
    console.warn('Invalid roster blueprint payload', error);
    return {};
  }
};

const applyBlueprint = (base: RosterEntry[]) => {
  const blueprintEntries = Object.values(loadBlueprint()).flat();
  if (!blueprintEntries.length) return base;
  return mergeRosterEntries(base, blueprintEntries);
};

interface DroppableContainerProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

const DroppableContainer: React.FC<DroppableContainerProps> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  
  return (
    <div 
      ref={setNodeRef} 
      className={`${className} ${isOver ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''} transition-all duration-300`}
    >
      {children}
    </div>
  );
};

interface SortableHandlerProps {
  handler: Handler;
  shift: string;
  colors: any;
  onShiftChange: (handlerId: string, shift: ShiftType) => void;
  onDelete: (handlerId: string) => void;
  shiftOptions: ShiftType[];
}

const SortableHandler: React.FC<SortableHandlerProps> = ({ handler, shift, colors, onShiftChange, onDelete, shiftOptions }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: handler.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    scale: isDragging ? 1.05 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDelete(handler.id);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl transition-all group ${colors.card} hover:opacity-95 shadow-sm active:scale-[0.98] cursor-default flex-1 min-h-9`}
    >
      <div className="flex items-center space-x-2 flex-1 min-w-0">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-800/40 hover:text-slate-900 transition-colors shrink-0">
          <GripVertical size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-slate-900 font-semibold text-[11px] block leading-tight whitespace-normal wrap-break-word">{handler.name}</span>
        </div>
      </div>

      <div className="flex items-center shrink-0 gap-2">
        <button
          onClick={handleDelete}
          className="p-1 rounded-md text-red-600 hover:bg-white/30 transition-all opacity-0 group-hover:opacity-100"
          title="Delete Agent"
        >
          <Trash2 size={14} />
        </button>
        <select 
          value={shift}
          onChange={(e) => onShiftChange(handler.id, e.target.value as ShiftType)}
          className={`text-[9px] font-black bg-white/30 px-1 py-0.5 rounded-md border-none focus:ring-0 ${colors.text} cursor-pointer outline-none opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest`}
        >
          {shiftOptions.map(s => (
            <option key={s} value={s} className="bg-white text-slate-900 font-bold">{s}</option>
          ))}
        </select>
      </div>
    </li>
  );
};

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

  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      const istFormat = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const ukFormat = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      const istStr = istFormat.format(now);
      const ukStr = ukFormat.format(now);

      setTimes({
        ist: istStr.replace(/\s(AM|PM)/, '\u00A0\u00A0$1'),
        uk: ukStr.replace(/\s(AM|PM)/, '\u00A0\u00A0$1')
      });
    };
    updateClocks();
    const timer = setInterval(updateClocks, 10000);
    return () => clearInterval(timer);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const availableShifts = useMemo(() => {
    const shiftSet = new Set(SHIFTS);
    roster
      .filter((entry) => entry.date === selectedDate)
      .map((entry) => entry.shift)
      .forEach((shift) => shiftSet.add(shift));
    return Array.from(shiftSet);
  }, [roster, selectedDate]);

  const shiftPickerOptions = useMemo(() => {
    const optionSet = new Set([...ALL_SHIFT_TYPES, ...availableShifts]);
    return Array.from(optionSet);
  }, [availableShifts]);

  useEffect(() => {
    const handleHandlers = (data: Handler[]) => {
      if (data) {
        setHandlers(data);
        localStorage.setItem('handlers', JSON.stringify(data));
      }
    };
    const handleRoster = (data: RosterEntry[]) => {
      if (data) {
        const merged = applyBlueprint(data);
        setRoster(merged);
        localStorage.setItem('roster', JSON.stringify(merged));
      }
    };

    socket.on('handlers_updated', handleHandlers);
    socket.on('roster_updated', handleRoster);
    socket.on('log_added', ({ dateStr, logEntry }) => {
      saveSingleLogFromServer(dateStr, logEntry);
    });
    
    const handleInit = (db: any) => {
      if (!db) return;
      if (Array.isArray(db.handlers)) {
        setHandlers(db.handlers as Handler[]);
        localStorage.setItem('handlers', JSON.stringify(db.handlers));
      } else if (Array.isArray(db.agents)) {
        setHandlers(db.agents as Handler[]);
        localStorage.setItem('handlers', JSON.stringify(db.agents));
      }
      if (Array.isArray(db.roster)) {
        const merged = applyBlueprint(db.roster as RosterEntry[]);
        setRoster(merged);
        localStorage.setItem('roster', JSON.stringify(merged));
      }
      if (db.logs) {
        saveLogsFromServer(db.logs);
      }
    };

    socket.on('init', handleInit);

    // initial data loaded via lazy initializers above

    // CRITICAL: If the socket is already connected (e.g. from App.tsx),
    // we need to request the state manually because we missed the 'init' event
    // that happened on connection.
    if (socket.connected) {
      socket.emit('get_initial_data');
    }

    return () => {
      socket.off('handlers_updated', handleHandlers);
      socket.off('roster_updated', handleRoster);
      socket.off('log_added');
      socket.off('init', handleInit);
    };
  }, []);

  // Log navigation when selectedDate changes (skip initial mount)
  const firstNavRef = useRef(true);
  useEffect(() => {
    if (firstNavRef.current) {
      firstNavRef.current = false;
      return;
    }
    // Save a NAVIGATE log under the date we navigated to
    addLogForDate(selectedDate, 'NAVIGATE', `Visited ${selectedDate}`);
    // Also add a regular log for today about navigation action
    addLog('NAVIGATE', `Visited ${selectedDate}`);
  }, [selectedDate]);

  

  const LEAVE_TYPES = ['EL', 'PL', 'UL', 'MID-LEAVE', 'WO', 'ML', 'CO'];

  const updateShift = (handlerId: string, shift: ShiftType) => {
    // If assigning to a leave type, require confirmation
    if (LEAVE_TYPES.includes(shift)) {
      setLeaveOperation({ type: 'assign', handlerId, toShift: shift });
      return;
    }

    // Normal update
    executeShiftUpdate(handlerId, shift);
  };

  const executeShiftUpdate = (handlerId: string, shift: ShiftType) => {
    const handler = handlers.find(a => a.id === handlerId);
    const updatedRoster = [...roster];
    const index = updatedRoster.findIndex(r => r.handlerId === handlerId && r.date === selectedDate);
    
    const oldShift = index > -1 ? updatedRoster[index].shift : 'Unassigned';

    if (index > -1) {
      updatedRoster[index] = { ...updatedRoster[index], shift };
    } else {
      updatedRoster.push({ handlerId, date: selectedDate, shift });
    }
    
    setRoster(updatedRoster);
    localStorage.setItem('roster', JSON.stringify(updatedRoster));
    syncData.updateRoster(updatedRoster);
    addLog('Update Shift', `${handler?.name || handlerId}: ${oldShift} -> ${shift} (Date: ${selectedDate})`);
  };

  function deleteHandlerGlobally(handlerId: string) {
    const handlerToDelete = handlers.find(a => a.id === handlerId);
    const updatedHandlers = handlers.filter(a => a.id !== handlerId);
    const updatedRoster = roster.filter(r => r.handlerId !== handlerId);

    setHandlers(updatedHandlers);
    setRoster(updatedRoster);

    localStorage.setItem('handlers', JSON.stringify(updatedHandlers));
    localStorage.setItem('roster', JSON.stringify(updatedRoster));
    syncData.updateHandlers(updatedHandlers);
    syncData.updateRoster(updatedRoster);
    addLog('Delete Agent', `Permanently deleted handler: ${handlerToDelete?.name || handlerId}`, 'negative');
  }

  const handleRosterFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    importRosterFromFile(file);
    event.target.value = '';
  };

  const importRosterFromFile = async (file: File) => {
    setImportStatus(null);
    setIsImportingRoster(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        setImportStatus({ message: 'File contains no sheets.', tone: 'error' });
        return;
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false });
      if (!rows.length) {
        setImportStatus({ message: 'File does not contain any rows.', tone: 'error' });
        return;
      }

      const newHandlers: Handler[] = [];
      const parsedEntries: RosterEntry[] = [];
      const rowErrors: string[] = [];
      const handlerLookup = new Map<string, string>();
      handlers.forEach((handler) => {
        handlerLookup.set(handler.name.trim().toLowerCase(), handler.id);
      });

      const extractEntry = (key: string, requiredTerms: string[], forbiddenTerms: string[] = []) => {
        const normalizedKey = key.trim().toLowerCase();
        const hasRequired = requiredTerms.every((term) => normalizedKey.includes(term));
        const hasForbidden = forbiddenTerms.some((term) => normalizedKey.includes(term));
        return hasRequired && !hasForbidden;
      };

      rows.forEach((row, rowIndex) => {
        const rowEntries = Object.entries(row);
        const isEmptyRow = rowEntries.every(([, value]) => normalizeCellValue(value) === '');
        if (isEmptyRow) return;

        const handlerCell = rowEntries.find(([key]) => extractEntry(key, ['agent', 'handler', 'name']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['name'], ['shift']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['personnel']));
        const shiftCell = rowEntries.find(([key]) => extractEntry(key, ['shift']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['status']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['roster']));
        const dateCell = rowEntries.find(([key]) => extractEntry(key, ['date']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['day']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['work']));

        const handlerName = normalizeCellValue(handlerCell?.[1]);
        const rawShiftValue = normalizeCellValue(shiftCell?.[1]);
        const parsedDate = parseExcelDate(dateCell?.[1]);
        const label = `Row ${rowIndex + 2}`;

        if (!handlerName) {
          rowErrors.push(`${label}: Handler Name missing.`);
          return;
        }
        if (!parsedDate) {
          rowErrors.push(`${label}: Invalid or missing date.`);
          return;
        }
        if (!rawShiftValue) {
          rowErrors.push(`${label}: Shift value missing.`);
          return;
        }

        // Normalize Shift: Upper case, no spaces, and try to match predefined types
        let shiftValue = rawShiftValue.toUpperCase().replace(/\s+/g, '');
        
        // Handle common variations
        if (shiftValue === 'OFF') shiftValue = 'WO';
        if (shiftValue === 'WEEKOFF') shiftValue = 'WO';

        // Try to find an exact match in our defined shifts (ignoring case/spaces)
        const match = ALL_SHIFT_TYPES.find(s => 
          s.toUpperCase().replace(/\s+/g, '') === shiftValue
        );
        if (match) shiftValue = match;

        const lookupKey = handlerName.toLowerCase();
        let handlerId = handlerLookup.get(lookupKey);
        if (!handlerId) {
          handlerId = createAgentId();
          handlerLookup.set(lookupKey, handlerId);
          newHandlers.push({ id: handlerId, name: handlerName, isQH: false });
        }

        parsedEntries.push({ handlerId, date: parsedDate, shift: shiftValue });
      });

      if (!parsedEntries.length) {
        setImportStatus({ message: 'No valid rows were found in the file.', tone: 'error' });
        return;
      }

      const mergedRoster = mergeRosterEntries(roster, parsedEntries);
      setRoster(mergedRoster);
      localStorage.setItem('roster', JSON.stringify(mergedRoster));
      syncData.updateRoster(mergedRoster);

      if (newHandlers.length) {
        const updatedHandlers = [...handlers, ...newHandlers];
        setHandlers(updatedHandlers);
        localStorage.setItem('handlers', JSON.stringify(updatedHandlers));
        syncData.updateHandlers(updatedHandlers);
      }

      const datesFromImport = parsedEntries.map((entry) => entry.date).sort();
      if (datesFromImport.length) {
        setSelectedDate(datesFromImport[0]);
      }

      const summaryParts = [`Imported ${parsedEntries.length} row(s).`];
      if (newHandlers.length) summaryParts.push(`Added ${newHandlers.length} new handler(s).`);
      if (rowErrors.length) summaryParts.push(`Skipped ${rowErrors.length} row(s).`);
      const tone: ImportFeedback['tone'] = rowErrors.length ? 'warning' : 'success';
      setImportStatus({ message: `${summaryParts.join(' ')}${rowErrors.length ? ` First issue: ${rowErrors[0]}` : ''}`, tone });
      addLog('Import Roster', `Imported ${parsedEntries.length} rows from ${file.name}`, 'positive');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import failure.';
      setImportStatus({ message: `Import failed: ${message}`, tone: 'error' });
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
      // Removing from leave: either unassign or place into target shift
      const to = leaveOperation.toShift;
      if (to === 'UNASSIGNED') {
        const updatedRoster = roster.filter(r => !(r.handlerId === leaveOperation.handlerId && r.date === selectedDate));
        setRoster(updatedRoster);
        localStorage.setItem('roster', JSON.stringify(updatedRoster));
        syncData.updateRoster(updatedRoster);
        const handler = handlers.find(a => a.id === leaveOperation.handlerId);
        addLog('Update Shift', `${handler?.name || leaveOperation.handlerId}: ${leaveOperation.fromShift} -> Unassigned (Date: ${selectedDate})`);
      } else if (to && to !== 'UNASSIGNED') {
        executeShiftUpdate(leaveOperation.handlerId, to as ShiftType);
      }
    }

    setLeaveOperation(null);
  };

  const handleLeaveCancel = () => {
    setLeaveOperation(null);
  };

  const handleAddAgentConfirm = () => {
    const name = newAgentName.trim();
    if (!name) return;
    const id = createAgentId();
    const newHandler: Handler = { id, name, isQH: false };
    const updatedHandlers = [...handlers, newHandler];
    setHandlers(updatedHandlers);
    localStorage.setItem('handlers', JSON.stringify(updatedHandlers));
    syncData.updateHandlers(updatedHandlers);

    // If a shift was selected, add roster entry for selectedDate
    if (newAgentShift) {
      const newEntry: RosterEntry = { handlerId: id, date: selectedDate, shift: newAgentShift };
      const updatedRoster = mergeRosterEntries(roster, [newEntry]);
      setRoster(updatedRoster);
      localStorage.setItem('roster', JSON.stringify(updatedRoster));
      syncData.updateRoster(updatedRoster);
      addLog('Register Agent', `Registered agent: ${name} and assigned to ${newAgentShift} on ${selectedDate}`, 'positive');
    } else {
      addLog('Register Agent', `Registered agent: ${name}`, 'positive');
    }

    setNewAgentName('');
    setNewAgentShift('');
    setIsModalOpen(false);
  };

  const handleAddAgentCancel = () => {
    setNewAgentName('');
    setNewAgentShift('');
    setIsModalOpen(false);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveId(null);

    if (!over) return;

    const handlerId = active.id as string;
    const overId = over.id as string;

    // Only allow delete if dragged horizontally (left/right)
    const isHorizontalDrag = Math.abs(delta.x) > Math.abs(delta.y);

    // Find current roster entry for this handler on selected date
    const currentEntry = roster.find(r => r.handlerId === handlerId && r.date === selectedDate);

    // If the handler is currently on leave and is being dragged out, require confirmation to remove
    if (currentEntry && LEAVE_TYPES.includes(currentEntry.shift)) {
      // If dropping onto OFF_DUTY and same leave type, do nothing
      if (overId === 'OFF_DUTY') {
        return;
      }

      // Determine target: shift or unassigned
      if (availableShifts.includes(overId as ShiftType)) {
        const targetShift = overId as ShiftType;
        if (targetShift === currentEntry.shift) return; // no-op
        setLeaveOperation({ type: 'remove', handlerId, fromShift: currentEntry.shift, toShift: targetShift });
        return;
      }

      if (overId === 'UNASSIGNED') {
        setLeaveOperation({ type: 'remove', handlerId, fromShift: currentEntry.shift, toShift: 'UNASSIGNED' });
        return;
      }
    }

    if (availableShifts.includes(overId as ShiftType)) {
      updateShift(handlerId, overId as ShiftType);
    } else if (overId === 'OFF_DUTY') {
      updateShift(handlerId, 'WO');
    }
    else if (overId === 'UNASSIGNED') {
      const updatedRoster = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
      setRoster(updatedRoster);
      localStorage.setItem('roster', JSON.stringify(updatedRoster));
    }
    else if (overId === 'TRASH' && isHorizontalDrag) {
      deleteHandlerGlobally(handlerId);
    }
    else {
      const overHandlerRoster = roster.find(r => r.handlerId === overId && r.date === selectedDate);
      if (overHandlerRoster) {
        updateShift(handlerId, overHandlerRoster.shift);
      } else {
        const isUnassigned = getUnassignedHandlers().some(a => a.id === overId);
        if (isUnassigned) {
          const updatedRoster = roster.filter(r => !(r.handlerId === handlerId && r.date === selectedDate));
          setRoster(updatedRoster);
          localStorage.setItem('roster', JSON.stringify(updatedRoster));
        }
      }
    }
  };

  const getHandlersForShift = (shift: string) => {
    const rosterForDay = roster.filter(r => r.date === selectedDate && r.shift === shift);
    return rosterForDay.map(r => handlers.find(a => a.id === r.handlerId)).filter(Boolean) as Handler[];
  };

  const getOffDutyHandlers = () => {
    const offDutyTypes = ['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'];
    const offDuty = roster.filter(r => r.date === selectedDate && offDutyTypes.includes(r.shift));
    return offDuty.map(r => ({
      handler: handlers.find(a => a.id === r.handlerId),
      reason: r.shift
    })).filter(item => item.handler) as { handler: Handler, reason: ShiftType }[];
  };

  const getUnassignedHandlers = () => {
    const assignedIds = roster.filter(r => r.date === selectedDate).map(r => r.handlerId);
    return handlers.filter(a => !assignedIds.includes(a.id));
  };

  const activeHandler = activeId ? handlers.find(a => a.id === activeId) : null;
  return (
    <div className="h-full flex flex-col overflow-hidden px-4 pb-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex overflow-hidden gap-4">
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 min-h-0">
              <div className={`relative overflow-hidden flex flex-col h-full min-h-0 bg-white/90 rounded-2xl text-black border border-white/30 ${isModalOpen ? 'filter blur-sm' : ''}`}>
                {/* Header Section - Part of Main Container */}
                <div className="bg-white/90 backdrop-blur-sm border-b border-white/30 flex justify-between items-center shrink-0 px-5 py-3 rounded-t-2xl">
                  <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-4">
                      <div className="w-8 h-8 bg-[#393E46] rounded-xl flex items-center justify-center border border-[#393E46] shadow-sm">
                        <CalendarIcon size={16} className="text-white" />
                      </div>
                      <div className="flex flex-col">
                        <h1 className="text-lg font-black text-[#222831] tracking-tight leading-none uppercase">Roster</h1>
                        <p className="text-[8px] text-slate-500 font-bold uppercase tracking-[0.25em] mt-0.5">Agent Roster</p>
                      </div>
                    </div>
                    <div className="h-8 w-px bg-slate-200" />

                    {/* Integrated Date Selector */}
                    <div className="flex items-center h-8 gap-1 bg-black/5 backdrop-blur-md px-2 rounded-xl border border-slate-200">
                      <button 
                        onClick={() => {
                          const [y, m, d] = selectedDate.split('-').map(Number);
                          const dateObj = new Date(y, m - 1, d);
                          dateObj.setDate(dateObj.getDate() - 1);
                          setSelectedDate(dateObj.toLocaleDateString('en-CA'));
                        }}
                        className="p-1 hover:bg-black/5 rounded-lg transition-colors text-slate-400 hover:text-slate-900"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      <div className="flex items-center gap-2 cursor-pointer group px-1 relative">
                        <div className="text-center min-w-[88px]">
                          <div className="text-[#222831] font-extrabold text-lg leading-none tabular-nums">{new Date(selectedDate + 'T00:00:00').getDate()}</div>
                          <div className="text-[11px] text-slate-500 font-black tracking-wide">{new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                        </div>
                        <input 
                          type="date" 
                          value={selectedDate}
                          onChange={(e) => setSelectedDate(e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full"
                          aria-label="Select date"
                          style={{ color: '#222831', WebkitTextFillColor: '#222831' }}
                        />
                      </div>

                      <button 
                        onClick={() => {
                          const [y, m, d] = selectedDate.split('-').map(Number);
                          const dateObj = new Date(y, m - 1, d);
                          dateObj.setDate(dateObj.getDate() + 1);
                          setSelectedDate(dateObj.toLocaleDateString('en-CA'));
                        }}
                        className="p-1 hover:bg-black/5 rounded-lg transition-colors text-slate-400 hover:text-slate-900"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>

                    {/* Integrated Time Center */}
                    <div className="flex items-center bg-black/5 rounded-xl p-1 border border-slate-200 overflow-hidden ml-2">
                      <div className="flex items-center gap-3 px-4 py-1.5 bg-white/60 rounded-lg">
                          <span className="text-[12px] font-black text-[#00ADB5] uppercase tracking-tighter border-r border-slate-200 pr-3">IST</span>
                          <span className="text-[15px] font-black text-[#222831] tabular-nums tracking-tighter leading-none">{times.ist}</span>
                        </div>
                        <div className="flex items-center gap-3 px-4 py-1.5 rounded-lg ml-0.5">
                          <span className="text-[12px] font-black text-[#393E46] uppercase tracking-tighter border-r border-slate-200 pr-3">GMT</span>
                          <span className="text-[15px] font-black text-[#222831] tabular-nums tracking-tighter leading-none">{times.uk}</span>
                        </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setIsModalOpen(!isModalOpen)}
                      className={`w-10 h-10 ${isModalOpen ? 'bg-rose-500 text-white shadow-rose-500/30' : 'bg-[#393E46] text-white shadow-[#393E46]/30'} rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-[0.98]`}
                      title="Register Agent"
                    >
                      <Plus size={18} className={`${isModalOpen ? 'rotate-45' : ''}`} />
                    </button>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImportingRoster}
                      className="px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-widest bg-[#222831] text-white hover:bg-[#222831]/90 transition-all shadow-md disabled:opacity-50"
                    >
                      {isImportingRoster ? 'Importing...' : 'Import Roster'}
                    </button>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      onChange={handleRosterFileChange}
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                    />
                  </div>
                </div>

                {importStatus && (
                  <div className={`mx-2 mt-2 p-3 rounded-2xl flex items-center justify-between backdrop-blur-md border animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm ${
                    importStatus.tone === 'success' ? 'bg-green-100 border-green-200 text-green-700' :
                    importStatus.tone === 'warning' ? 'bg-[#00ADB5]/10 border-[#00ADB5]/30 text-[#00ADB5]' :
                    'bg-rose-100 border-rose-200 text-rose-700'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        importStatus.tone === 'success' ? 'bg-green-500' :
                        importStatus.tone === 'warning' ? 'bg-[#00ADB5]' :
                        'bg-rose-500'
                      }`} />
                      <span className="text-[11px] font-black uppercase tracking-wider">{importStatus.message}</span>
                    </div>
                    <button onClick={() => setImportStatus(null)} className="p-1 hover:bg-black/5 rounded-lg transition-colors text-inherit opacity-50 hover:opacity-100">
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Table Content Section */}
                <div className="p-2 flex flex-col flex-1 min-h-0">
                  <div className="flex-1 overflow-auto">
                    <table className="w-full table-fixed border-collapse h-full">
                      <thead>
                        <tr className="text-[10px] font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-300">
                          {SHIFTS.map(shift => {
                            const colors = getShiftColor(shift);
                            const shiftHandlers = getHandlersForShift(shift);
                            return (
                              <th key={shift} className={`px-4 py-3 text-left border-r border-slate-300 ${colors.light}`}>
                                <div className="flex items-center justify-between">
                                  <span className="inline-block">{shift}</span>
                                  <div className="flex items-center gap-3">
                                    <div className={`w-2.5 h-2.5 rounded-full ${colors.bg}`} />
                                    <span className="text-[12px] font-black text-slate-900">{shiftHandlers.length}</span>
                                  </div>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="h-full">
                        <tr className="h-full">
                          {SHIFTS.map((shift) => {
                            const colors = getShiftColor(shift);
                            const shiftHandlers = getHandlersForShift(shift);
                            return (
                              <td key={shift} className="align-top px-2 pb-3 border-r border-slate-300 h-full">
                                <div className="sr-only">{shift}</div>
                                <DroppableContainer id={shift} className="px-0 pt-3 pb-3 h-full">
                                  <SortableContext
                                    id={shift}
                                    items={shiftHandlers.map(a => a.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <ul className="flex flex-col gap-1.5 h-full">
                                      {shiftHandlers.map(handler => (
                                        <SortableHandler 
                                          key={handler.id} 
                                          handler={handler} 
                                          shift={shift} 
                                          colors={colors} 
                                          onShiftChange={updateShift}
                                          onDelete={deleteHandlerGlobally}
                                          shiftOptions={shiftPickerOptions}
                                        />
                                      ))}
                                      {shiftHandlers.length === 0 && (
                                        <li className="flex flex-col items-center justify-center p-4 opacity-80 shrink-0 border-2 border-dashed border-slate-200 rounded-3xl mt-2 bg-transparent h-full">
                                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Empty</span>
                                        </li>
                                      )}
                                    </ul>
                                  </SortableContext>
                                </DroppableContainer>
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Leaves / Week Off Section - pinned inside main card */}
                  <div className="flex-shrink-0 bg-white/90 backdrop-blur-sm rounded-b-3xl border-t border-white/30 flex flex-col h-auto shadow-inner mt-auto text-black">
                    <div className="px-6 py-4 flex items-center justify-between shrink-0 rounded-b-3xl">
                      <div className="flex items-center gap-3">
                          <h2 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Leaves / Week Off</h2>
                          <span className="bg-black/5 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider border border-slate-200">
                            {getOffDutyHandlers().length} Agents
                          </span>
                      </div>

                      <div className="w-10 h-10" />
                    </div>

                    <DroppableContainer id="OFF_DUTY" className="p-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                      <SortableContext
                        id="OFF_DUTY"
                        items={getOffDutyHandlers().map(item => item.handler.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="flex flex-wrap gap-2 h-auto content-start pb-2">
                          {getOffDutyHandlers().map(({ handler, reason }) => (
                            <div key={handler.id} className="w-56 shrink-0">
                              <SortableHandler 
                                handler={handler} 
                                shift={reason} 
                                colors={getShiftColor(reason)} 
                                onShiftChange={updateShift}
                                onDelete={deleteHandlerGlobally}
                                shiftOptions={shiftPickerOptions}
                              />
                            </div>
                          ))}
                        </div>
                      </SortableContext>
                    </DroppableContainer>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeId && activeHandler ? (
            <div className={`flex items-center justify-between p-4 rounded-2xl border border-slate-200 bg-white/60 backdrop-blur-2xl shadow-2xl scale-110 w-64`}>
              <div className="flex items-center space-x-3 ml-2">
                <div>
                  <span className="text-[#222831] font-black text-sm block leading-tight">{activeHandler.name}</span>
                  <span className="text-[8px] font-black text-[#393E46] uppercase tracking-widest mt-1 block">Relocating...</span>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>

        {/* Trash Zone */}
        {activeId && (
          <>
            <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-20 h-24" id="TRASH"></div>
            <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-20 h-24" id="TRASH"></div>
          </>
        )}
      </DndContext>

      {/* Leave Confirmation Modal */}
      {leaveOperation && (
        <div className="fixed inset-0 flex items-center justify-center z-100 p-6">
          <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" onClick={handleLeaveCancel} />
          <div className="bg-white/90 backdrop-blur-3xl rounded-4xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200">
            <div className="p-8 pb-4">
              <div className="flex items-center justify-between mb-8">
                <div className="w-12 h-12 bg-[#00ADB5]/10 rounded-2xl flex items-center justify-center border border-[#00ADB5]/20">
                  <AlertCircle size={24} className="text-[#00ADB5]" />
                </div>
                <button 
                  onClick={handleLeaveCancel}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <h3 className="text-2xl font-black text-[#222831] tracking-tight mb-2">
                {leaveOperation.type === 'assign' ? 'Confirm Leave Assignment' : 'Confirm Remove From Leave'}
              </h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-8">
                {leaveOperation.type === 'assign' ? 'Assign this handler to leave status' : 'Remove this handler from leave status?'}
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="p-4 bg-[#00ADB5]/10 rounded-xl border border-[#00ADB5]/20">
                  <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-2">Handler</p>
                  <p className="text-lg font-black text-slate-900">{handlers.find(a => a.id === leaveOperation.handlerId)?.name || 'Unknown'}</p>
                </div>
                {leaveOperation.type === 'assign' && (
                  <div className="p-4 bg-[#00ADB5]/10 rounded-xl border border-[#00ADB5]/20">
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-2">Leave Type</p>
                    <p className="text-lg font-black text-[#00ADB5]">{leaveOperation.toShift}</p>
                  </div>
                )}
                {leaveOperation.type === 'remove' && (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-2">Current Leave</p>
                    <p className="text-lg font-black text-slate-900">{leaveOperation.fromShift}</p>
                    <p className="text-sm text-slate-500 mt-2">This will be replaced by: {leaveOperation.toShift === 'UNASSIGNED' ? 'Unassigned' : leaveOperation.toShift}</p>
                  </div>
                )}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-2">Date</p>
                  <p className="text-lg font-black text-slate-900">{new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            
            <div className="p-8 pt-4 flex gap-4">
              <button 
                onClick={handleLeaveCancel}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleLeaveConfirm}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-[#222831] text-white hover:bg-[#222831]/90 transition-all shadow-xl shadow-[#222831]/20 active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Register Agent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-100 p-6">
          <div className="absolute inset-0 bg-black/10" onClick={handleAddAgentCancel} />
          <div className="bg-white/90 rounded-4xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="w-12 h-12 bg-[#393E46]/10 rounded-2xl flex items-center justify-center border border-[#393E46]/20">
                  <CalendarIcon size={24} className="text-[#393E46]" />
                </div>
                <button 
                  onClick={handleAddAgentCancel}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <h3 className="text-2xl font-black text-[#222831] tracking-tight mb-2">Register Agent</h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-6">Add a new agent to the roster</p>

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Name</label>
                  <input
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none"
                    placeholder="Agent name"
                  />
                </div>

                <div className="relative">
                  <label className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Shift</label>
                  <p className="text-xs text-slate-500">Assign agent to a shift for the selected date (optional)</p>

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setNewAgentShiftOpen(s => !s)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-slate-200 bg-white/90 text-left"
                    >
                      <span className="truncate">{newAgentShift || 'No initial shift'}</span>
                      <svg className="w-4 h-4 text-slate-500" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>

                    {newAgentShiftOpen && (
                      <div className="absolute z-50 mt-2 w-full max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                        <ul className="divide-y divide-slate-100">
                          <li>
                            <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50" onClick={() => { setNewAgentShift(''); setNewAgentShiftOpen(false); }}>
                              No initial shift
                            </button>
                          </li>
                          {shiftPickerOptions.map((s) => (
                            <li key={s}>
                              <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50" onClick={() => { setNewAgentShift(s); setNewAgentShiftOpen(false); }}>
                                {s}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 pt-4 flex gap-4">
              <button 
                onClick={handleAddAgentCancel}
                className="flex-1 px-6 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddAgentConfirm}
                className="flex-1 px-6 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-[#222831] text-white hover:bg-[#222831]/90 transition-all shadow-xl shadow-[#222831]/20 active:scale-95"
              >
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

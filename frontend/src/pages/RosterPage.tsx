import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MOCK_AGENTS, SHIFTS, MOCK_ROSTER } from '../data/mockData';
import { Calendar as CalendarIcon, GripVertical, Plus, X, Trash2, FileText, Database, AlertCircle } from 'lucide-react';
import type { Agent, RosterEntry, ShiftType } from '../types';
import { addLog, downloadLogsForDate, downloadAllLogs, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';
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
  '6AM-3PM', '1PM-10PM', '2PM-11PM', '10PM-7AM', '12PM-9PM',
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
    case '6AM-3PM': return { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50', border: 'border-blue-200', card: 'bg-[#bae6fd]' };
    case '1PM-10PM': return { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-200', card: 'bg-[#fef08a]' };
    case '2PM-11PM': return { bg: 'bg-orange-600', text: 'text-orange-600', light: 'bg-orange-50', border: 'border-orange-200', card: 'bg-[#fed7aa]' };
    case '10PM-7AM': return { bg: 'bg-slate-700', text: 'text-slate-700', light: 'bg-slate-100', border: 'border-slate-300', card: 'bg-[#94a3b8]' };
    case '12PM-9PM': return { bg: 'bg-fuchsia-600', text: 'text-fuchsia-600', light: 'bg-fuchsia-50', border: 'border-fuchsia-200', card: 'bg-[#f5d0fe]' };
    case 'EL':
    case 'PL':
    case 'UL':
    case 'MID-LEAVE': return { bg: 'bg-rose-600', text: 'text-rose-600', light: 'bg-rose-50', border: 'border-rose-200', card: 'bg-rose-200' };
    default: return { bg: 'bg-slate-500', text: 'text-slate-500', light: 'bg-slate-50', border: 'border-slate-200', card: 'bg-slate-200' };
  }
};

const BLUEPRINT_CACHE_KEY = 'roster_blueprint';

const mergeRosterEntries = (base: RosterEntry[], additions: RosterEntry[]) => {
  const merged = [...base];
  additions.forEach(entry => {
    const idx = merged.findIndex(r => r.agentId === entry.agentId && r.date === entry.date);
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

interface SortableAgentProps {
  agent: Agent;
  shift: string;
  colors: any;
  onShiftChange: (agentId: string, shift: ShiftType) => void;
  onDelete: (agentId: string) => void;
  shiftOptions: ShiftType[];
}

const SortableAgent: React.FC<SortableAgentProps> = ({ agent, shift, colors, onShiftChange, onDelete, shiftOptions }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: agent.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    scale: isDragging ? 1.05 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDelete(agent.id);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl transition-all group ${colors.card} hover:opacity-95 shadow-sm active:scale-[0.98] cursor-default flex-1 min-h-[36px]`}
    >
      <div className="flex items-center space-x-2 flex-1 min-w-0">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-800/40 hover:text-slate-900 transition-colors shrink-0">
          <GripVertical size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-slate-900 font-semibold text-[11px] block leading-tight whitespace-normal break-words">{agent.name}</span>
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
          onChange={(e) => onShiftChange(agent.id, e.target.value as ShiftType)}
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentShift, setNewAgentShift] = useState<ShiftType>('Unassigned');
  const [isLeaveConfirmModalOpen, setIsLeaveConfirmModalOpen] = useState(false);
  const [pendingLeaveAssignment, setPendingLeaveAssignment] = useState<{ agentId: string; shift: ShiftType } | null>(null);
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
    const handleAgents = (data: any) => {
      if (data) {
        setAgents(data);
        localStorage.setItem('agents', JSON.stringify(data));
      }
    };
    const handleRoster = (data: any) => {
      if (data) {
        const merged = applyBlueprint(data);
        setRoster(merged);
        localStorage.setItem('roster', JSON.stringify(merged));
      }
    };

    socket.on('agents_updated', handleAgents);
    socket.on('roster_updated', handleRoster);
    socket.on('log_added', ({ dateStr, logEntry }) => {
      saveSingleLogFromServer(dateStr, logEntry);
    });
    
    const handleInit = (db: any) => {
      console.log('Received INIT data from server');
      if (db.agents) {
        setAgents(db.agents);
        localStorage.setItem('agents', JSON.stringify(db.agents));
      }
      if (db.roster) {
        const merged = applyBlueprint(db.roster);
        setRoster(merged);
        localStorage.setItem('roster', JSON.stringify(merged));
      }
      if (db.logs) {
        saveLogsFromServer(db.logs);
      }
    };

    socket.on('init', handleInit);

    // Initial load from localStorage as fallback
    const savedAgents = localStorage.getItem('agents');
    if (savedAgents) setAgents(JSON.parse(savedAgents));
    else setAgents(MOCK_AGENTS);

    const savedRoster = localStorage.getItem('roster');
    const baseRoster = savedRoster ? JSON.parse(savedRoster) : MOCK_ROSTER;
    setRoster(applyBlueprint(baseRoster));

    // CRITICAL: If the socket is already connected (e.g. from App.tsx),
    // we need to request the state manually because we missed the 'init' event
    // that happened on connection.
    if (socket.connected) {
      socket.emit('get_initial_data');
    }

    return () => {
      socket.off('agents_updated', handleAgents);
      socket.off('roster_updated', handleRoster);
      socket.off('log_added');
      socket.off('init', handleInit);
    };
  }, []);

  const handleAddAgent = () => {
    if (!newAgentName.trim()) return;

    const newAgentId = createAgentId();
    const newAgent: Agent = {
      id: newAgentId,
      name: newAgentName.trim(),
      isQH: false
    };

    const updatedAgents = [...agents, newAgent];
    setAgents(updatedAgents);
    
    let logMsg = `Registered new agent: ${newAgent.name}`;

    // Handle initial shift assignment if provided
    let updatedRoster = [...roster];
    if (newAgentShift && newAgentShift !== 'Unassigned') {
      updatedRoster.push({
        agentId: newAgentId,
        date: selectedDate,
        shift: newAgentShift
      });
      setRoster(updatedRoster);
      localStorage.setItem('roster', JSON.stringify(updatedRoster));
      syncData.updateRoster(updatedRoster);
      logMsg += ` assigned to ${newAgentShift}`;
    }

    localStorage.setItem('agents', JSON.stringify(updatedAgents));
    syncData.updateAgents(updatedAgents);

    setNewAgentName('');
    setNewAgentShift('Unassigned');
    setIsModalOpen(false);
    addLog('Add Agent', logMsg, 'positive');
  };

  const LEAVE_TYPES = ['EL', 'PL', 'UL', 'MID-LEAVE', 'WO', 'ML', 'CO'];

  const updateShift = (agentId: string, shift: ShiftType) => {
    // Check if this is a leave type assignment
    if (LEAVE_TYPES.includes(shift)) {
      setPendingLeaveAssignment({ agentId, shift });
      setIsLeaveConfirmModalOpen(true);
      return;
    }

    // Execute normal shift update
    executeShiftUpdate(agentId, shift);
  };

  const executeShiftUpdate = (agentId: string, shift: ShiftType) => {
    const agent = agents.find(a => a.id === agentId);
    const updatedRoster = [...roster];
    const index = updatedRoster.findIndex(r => r.agentId === agentId && r.date === selectedDate);
    
    const oldShift = index > -1 ? updatedRoster[index].shift : 'Unassigned';

    if (index > -1) {
      updatedRoster[index] = { ...updatedRoster[index], shift };
    } else {
      updatedRoster.push({ agentId, date: selectedDate, shift });
    }
    
    setRoster(updatedRoster);
    localStorage.setItem('roster', JSON.stringify(updatedRoster));
    syncData.updateRoster(updatedRoster);
    addLog('Update Shift', `${agent?.name || agentId}: ${oldShift} -> ${shift} (Date: ${selectedDate})`);
  };

  function deleteAgentGlobally(agentId: string) {
    const agentToDelete = agents.find(a => a.id === agentId);
    const updatedAgents = agents.filter(a => a.id !== agentId);
    const updatedRoster = roster.filter(r => r.agentId !== agentId);

    setAgents(updatedAgents);
    setRoster(updatedRoster);

    localStorage.setItem('agents', JSON.stringify(updatedAgents));
    localStorage.setItem('roster', JSON.stringify(updatedRoster));
    syncData.updateAgents(updatedAgents);
    syncData.updateRoster(updatedRoster);
    addLog('Delete Agent', `Permanently deleted agent: ${agentToDelete?.name || agentId}`, 'negative');
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

      const newAgents: Agent[] = [];
      const parsedEntries: RosterEntry[] = [];
      const rowErrors: string[] = [];
      const agentLookup = new Map<string, string>();
      agents.forEach((agent) => {
        agentLookup.set(agent.name.trim().toLowerCase(), agent.id);
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

        const agentCell = rowEntries.find(([key]) => extractEntry(key, ['agent', 'name']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['name'], ['shift']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['personnel']));
        const shiftCell = rowEntries.find(([key]) => extractEntry(key, ['shift']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['status']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['roster']));
        const dateCell = rowEntries.find(([key]) => extractEntry(key, ['date']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['day']))
          ?? rowEntries.find(([key]) => extractEntry(key, ['work']));

        const agentName = normalizeCellValue(agentCell?.[1]);
        const rawShiftValue = normalizeCellValue(shiftCell?.[1]);
        const parsedDate = parseExcelDate(dateCell?.[1]);
        const label = `Row ${rowIndex + 2}`;

        if (!agentName) {
          rowErrors.push(`${label}: Agent Name missing.`);
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

        const lookupKey = agentName.toLowerCase();
        let agentId = agentLookup.get(lookupKey);
        if (!agentId) {
          agentId = createAgentId();
          agentLookup.set(lookupKey, agentId);
          newAgents.push({ id: agentId, name: agentName, isQH: false });
        }

        parsedEntries.push({ agentId, date: parsedDate, shift: shiftValue });
      });

      if (!parsedEntries.length) {
        setImportStatus({ message: 'No valid rows were found in the file.', tone: 'error' });
        return;
      }

      const mergedRoster = mergeRosterEntries(roster, parsedEntries);
      setRoster(mergedRoster);
      localStorage.setItem('roster', JSON.stringify(mergedRoster));
      syncData.updateRoster(mergedRoster);

      if (newAgents.length) {
        const updatedAgents = [...agents, ...newAgents];
        setAgents(updatedAgents);
        localStorage.setItem('agents', JSON.stringify(updatedAgents));
        syncData.updateAgents(updatedAgents);
      }

      const datesFromImport = parsedEntries.map((entry) => entry.date).sort();
      if (datesFromImport.length) {
        setSelectedDate(datesFromImport[0]);
      }

      const summaryParts = [`Imported ${parsedEntries.length} row(s).`];
      if (newAgents.length) summaryParts.push(`Added ${newAgents.length} new agent(s).`);
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
    if (pendingLeaveAssignment) {
      executeShiftUpdate(pendingLeaveAssignment.agentId, pendingLeaveAssignment.shift);
      setPendingLeaveAssignment(null);
      setIsLeaveConfirmModalOpen(false);
    }
  };

  const handleLeaveCancel = () => {
    setPendingLeaveAssignment(null);
    setIsLeaveConfirmModalOpen(false);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveId(null);

    if (!over) return;

    const agentId = active.id as string;
    const overId = over.id as string;

    // Only allow delete if dragged horizontally (left/right)
    const isHorizontalDrag = Math.abs(delta.x) > Math.abs(delta.y);

    if (availableShifts.includes(overId as ShiftType)) {
      updateShift(agentId, overId as ShiftType);
    } 
    else if (overId === 'OFF_DUTY') {
      updateShift(agentId, 'WO');
    }
    else if (overId === 'UNASSIGNED') {
      const updatedRoster = roster.filter(r => !(r.agentId === agentId && r.date === selectedDate));
      setRoster(updatedRoster);
      localStorage.setItem('roster', JSON.stringify(updatedRoster));
    }
    else if (overId === 'TRASH' && isHorizontalDrag) {
      deleteAgentGlobally(agentId);
    }
    else {
      const overAgentRoster = roster.find(r => r.agentId === overId && r.date === selectedDate);
      if (overAgentRoster) {
        updateShift(agentId, overAgentRoster.shift);
      } else {
        const isUnassigned = getUnassignedAgents().some(a => a.id === overId);
        if (isUnassigned) {
          const updatedRoster = roster.filter(r => !(r.agentId === agentId && r.date === selectedDate));
          setRoster(updatedRoster);
          localStorage.setItem('roster', JSON.stringify(updatedRoster));
        }
      }
    }
  };

  const getAgentsForShift = (shift: string) => {
    const rosterForDay = roster.filter(r => r.date === selectedDate && r.shift === shift);
    return rosterForDay.map(r => agents.find(a => a.id === r.agentId)).filter(Boolean) as Agent[];
  };

  const getOffDutyAgents = () => {
    const offDutyTypes = ['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'];
    const offDuty = roster.filter(r => r.date === selectedDate && offDutyTypes.includes(r.shift));
    return offDuty.map(r => ({
      agent: agents.find(a => a.id === r.agentId),
      reason: r.shift
    })).filter(item => item.agent) as { agent: Agent, reason: ShiftType }[];
  };

  const getUnassignedAgents = () => {
    const assignedIds = roster.filter(r => r.date === selectedDate).map(r => r.agentId);
    return agents.filter(a => !assignedIds.includes(a.id));
  };

  const activeAgent = activeId ? agents.find(a => a.id === activeId) : null;

  return (
    <div className="h-full flex flex-col overflow-hidden px-4 pb-4">
      {/* Header - Compact Integrated Bar */}
      <div className="mb-3 mt-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl flex justify-between items-center shrink-0 px-5 py-2 shadow-sm">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 shadow-sm">
              <CalendarIcon size={16} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold text-white tracking-tight leading-none uppercase">Roster Control</h1>
              <p className="text-[8px] text-white/40 font-bold uppercase tracking-[0.25em] mt-0.5">Handler Shift Board</p>
            </div>
          </div>

          <div className="h-8 w-px bg-white/10" />

          {/* Integrated Date Selector */}
          <div className="flex items-center h-8 gap-1 bg-white/10 backdrop-blur-md px-2 rounded-xl border border-white/10">
            <button 
              onClick={() => {
                const [y, m, d] = selectedDate.split('-').map(Number);
                const dateObj = new Date(y, m - 1, d);
                dateObj.setDate(dateObj.getDate() - 1);
                setSelectedDate(dateObj.toLocaleDateString('en-CA'));
              }}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex items-center gap-2 cursor-pointer group px-1 relative">
              <span className="text-white font-medium text-[10px] uppercase tracking-widest min-w-[80px] text-center">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full"
              />
            </div>

            <button 
              onClick={() => {
                const [y, m, d] = selectedDate.split('-').map(Number);
                const dateObj = new Date(y, m - 1, d);
                dateObj.setDate(dateObj.getDate() + 1);
                setSelectedDate(dateObj.toLocaleDateString('en-CA'));
              }}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Integrated Time Center */}
          <div className="flex items-center bg-white/5 rounded-xl p-1 border border-white/10 overflow-hidden ml-2">
            <div className="flex items-center gap-3 px-4 py-1.5 bg-white/10 rounded-lg">
              <span className="text-[12px] font-medium text-yellow-400 uppercase tracking-tighter border-r border-white/10 pr-3">IST</span>
              <span className="text-[15px] font-medium text-white tabular-nums tracking-tighter leading-none">{times.ist}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-lg ml-0.5">
              <span className="text-[12px] font-medium text-yellow-400 uppercase tracking-tighter border-r border-white/10 pr-3">GMT</span>
              <span className="text-[15px] font-medium text-white tabular-nums tracking-tighter leading-none">{times.uk}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImportingRoster}
            className="px-4 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-widest bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-sm disabled:opacity-50"
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
        <div className={`mb-4 mx-2 p-3 rounded-2xl flex items-center justify-between backdrop-blur-md border animate-in fade-in slide-in-from-top-2 duration-300 ${
          importStatus.tone === 'success' ? 'bg-green-500/20 border-green-500/30 text-green-200' :
          importStatus.tone === 'warning' ? 'bg-amber-500/20 border-amber-500/30 text-amber-200' :
          'bg-rose-500/20 border-rose-500/30 text-rose-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              importStatus.tone === 'success' ? 'bg-green-400' :
              importStatus.tone === 'warning' ? 'bg-amber-400' :
              'bg-rose-400'
            }`} />
            <span className="text-[11px] font-bold uppercase tracking-wider">{importStatus.message}</span>
          </div>
          <button onClick={() => setImportStatus(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X size={14} />
          </button>
        </div>
      )}


      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex overflow-hidden gap-4">
          {/* Main Roster Area */}
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Shifts Grid - Horizontal all 5 shifts */}
            <div className="flex-1 min-h-0">
              <div className="grid grid-cols-5 gap-4 h-full">
                {SHIFTS.map((shift) => {
                  const colors = getShiftColor(shift);
                  const shiftAgents = getAgentsForShift(shift);
                  return (
                    <div key={shift} className="bg-white/10 backdrop-blur-2xl rounded-[32px] border border-white/10 flex flex-col overflow-hidden group/column shadow-xl">
                    <div className="px-5 py-6 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${colors.bg}`} />
                        <span className={`text-[10px] font-normal text-white uppercase tracking-widest`}>{shift}</span>
                      </div>
                      <span className={`text-[10px] font-bold text-white bg-white/20 backdrop-blur-md w-6 h-6 flex items-center justify-center rounded-full border border-white/30 shadow-sm`}>
                        {shiftAgents.length}
                      </span>
                    </div>
                      <DroppableContainer id={shift} className="px-3 pb-6 overflow-y-auto flex-1 scrollbar-hide">
                        <SortableContext
                          id={shift}
                          items={shiftAgents.map(a => a.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="flex flex-col gap-1.5">
                            {shiftAgents.map(agent => (
                              <SortableAgent 
                                key={agent.id} 
                                agent={agent} 
                                shift={shift} 
                                colors={colors} 
                                onShiftChange={updateShift}
                                onDelete={deleteAgentGlobally}
                                shiftOptions={shiftPickerOptions}
                              />
                            ))}
                            {shiftAgents.length === 0 && (
                            <li className="flex flex-col items-center justify-center p-8 opacity-40 shrink-0 border-2 border-dashed border-white/20 rounded-3xl mt-2">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-white/60">Empty</span>
                              </li>
                            )}
                          </ul>
                        </SortableContext>
                      </DroppableContainer>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Leaves & Week Off Section */}
            {getOffDutyAgents().length > 0 && (
              <div className="bg-white/10 backdrop-blur-2xl rounded-3xl border border-white/20 flex flex-col px-5 py-4 shadow-xl">
                <h3 className="text-[10px] font-bold text-white/60 uppercase tracking-[0.2em] mb-3 ml-1">Leaves / Week Off</h3>
                <DroppableContainer id="OFF_DUTY" className="min-h-[40px]">
                  <SortableContext
                    id="OFF_DUTY"
                    items={getOffDutyAgents().map(item => item.agent.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-wrap gap-2">
                      {getOffDutyAgents().map(({ agent, reason }) => (
                        <div key={agent.id} className="w-56 shrink-0">
                          <SortableAgent 
                            agent={agent} 
                            shift={reason} 
                            colors={getShiftColor(reason)} 
                            onShiftChange={updateShift}
                            onDelete={deleteAgentGlobally}
                            shiftOptions={shiftPickerOptions}
                          />
                        </div>
                      ))}
                    </div>
                  </SortableContext>
                </DroppableContainer>
              </div>
            )}

            {/* Unassigned Pool Section */}
            <div className="bg-white/10 backdrop-blur-2xl rounded-[32px] border border-white/20 flex flex-col h-auto max-h-[500px] shadow-xl relative z-40">
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 rounded-t-[32px]">
                <div className="flex items-center gap-3">
                  <h2 className="text-[10px] font-bold text-white uppercase tracking-widest">Unassigned Pool</h2>
                  <span className="bg-white/10 text-white/80 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-white/20">
                    {getUnassignedAgents().length} Handlers
                  </span>
                </div>
                
                <div className="relative">
                  <button 
                    onClick={() => setIsModalOpen(!isModalOpen)}
                    className={`w-10 h-10 ${isModalOpen ? 'bg-rose-500 text-white' : 'bg-white text-slate-900'} rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-[0.98]`}
                    title="Add Handler"
                  >
                    <Plus size={20} className={`transition-transform duration-300 ${isModalOpen ? 'rotate-45' : ''}`} />
                  </button>

                  {isModalOpen && (
                    <div className="absolute bottom-full right-0 mb-4 w-72 bg-teal-50/90 backdrop-blur-3xl rounded-[32px] border border-teal-200/30 shadow-2xl p-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <h3 className="text-sm font-black text-slate-800 tracking-tight mb-4 uppercase">Register Handler</h3>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Full Name</label>
                          <input 
                            autoFocus
                            value={newAgentName}
                            onChange={(e) => setNewAgentName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()}
                            placeholder="Full Name"
                            className="w-full px-4 py-2.5 bg-white/50 border border-teal-200/20 rounded-xl outline-none text-slate-800 font-bold text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Shift (Optional)</label>
                          <select 
                            value={newAgentShift}
                            onChange={(e) => setNewAgentShift(e.target.value as ShiftType)}
                            className="w-full px-4 py-2.5 bg-white/50 border border-teal-200/20 rounded-xl outline-none text-slate-800 font-bold text-xs appearance-none"
                          >
                            <option value="Unassigned">Unassigned Pool</option>
                            {shiftPickerOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={handleAddAgent}
                            disabled={!newAgentName.trim()}
                            className="flex-1 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest py-3 rounded-xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all disabled:opacity-30"
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <DroppableContainer id="UNASSIGNED" className="p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                <SortableContext
                  id="UNASSIGNED"
                  items={getUnassignedAgents().map(a => a.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-wrap gap-2 h-auto content-start pb-2">
                    {getUnassignedAgents().map(agent => (
                      <div key={agent.id} className="w-56 shrink-0">
                        <SortableAgent 
                          agent={agent} 
                          shift="Unassigned" 
                          colors={{ bg: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-100', border: 'border-blue-200', card: 'bg-white/40' }} 
                          onShiftChange={updateShift}
                          onDelete={deleteAgentGlobally}
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

        <DragOverlay>
          {activeId && activeAgent ? (
            <div className={`flex items-center justify-between p-4 rounded-2xl border border-teal-200/20 bg-teal-50/40 backdrop-blur-2xl shadow-2xl scale-110 w-64`}>
              <div className="flex items-center space-x-3 ml-2">
                <div>
                  <span className="text-slate-800 font-black text-sm block leading-tight">{activeAgent.name}</span>
                  <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest mt-1 block">Relocating...</span>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>

        {/* Trash Zone - Left and Right Sides */}
        {activeId && (
          <>
            <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-20 h-24" id="TRASH"></div>
            <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-20 h-24" id="TRASH"></div>
          </>
        )}
      </DndContext>

      {/* Leave Confirmation Modal */}
      {isLeaveConfirmModalOpen && pendingLeaveAssignment && (
        <div className="fixed inset-0 flex items-center justify-center z-100 p-6">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={handleLeaveCancel} />
          <div className="bg-rose-50/60 backdrop-blur-3xl rounded-4xl border border-rose-200/30 shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200">
            <div className="p-8 pb-4">
              <div className="flex items-center justify-between mb-8">
                <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-200/20">
                  <AlertCircle size={24} className="text-rose-600" />
                </div>
                <button 
                  onClick={handleLeaveCancel}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-rose-50/40 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Confirm Leave Assignment</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-8">Assign this agent to leave status</p>
              
              <div className="space-y-4 mb-8">
                <div className="p-4 bg-rose-100/30 rounded-xl border border-rose-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Agent</p>
                  <p className="text-lg font-black text-slate-800">{agents.find(a => a.id === pendingLeaveAssignment.agentId)?.name || 'Unknown'}</p>
                </div>
                <div className="p-4 bg-rose-100/30 rounded-xl border border-rose-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Leave Type</p>
                  <p className="text-lg font-black text-rose-600">{pendingLeaveAssignment.shift}</p>
                </div>
                <div className="p-4 bg-slate-100/30 rounded-xl border border-slate-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Date</p>
                  <p className="text-lg font-black text-slate-800">{new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            
            <div className="p-8 pt-4 flex gap-4">
              <button 
                onClick={handleLeaveCancel}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:bg-rose-50/40 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleLeaveConfirm}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-rose-600 text-white hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20 active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation Modal */}
      {isLeaveConfirmModalOpen && pendingLeaveAssignment && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] p-6">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={handleLeaveCancel} />
          <div className="bg-rose-50/60 backdrop-blur-3xl rounded-[2rem] border border-rose-200/30 shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200">
            <div className="p-8 pb-4">
              <div className="flex items-center justify-between mb-8">
                <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-200/20">
                  <AlertCircle size={24} className="text-rose-600" />
                </div>
                <button 
                  onClick={handleLeaveCancel}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-rose-50/40 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Confirm Leave Assignment</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-8">Assign this agent to leave status</p>
              
              <div className="space-y-4 mb-8">
                <div className="p-4 bg-rose-100/30 rounded-xl border border-rose-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Agent</p>
                  <p className="text-lg font-black text-slate-800">{agents.find(a => a.id === pendingLeaveAssignment.agentId)?.name || 'Unknown'}</p>
                </div>
                <div className="p-4 bg-rose-100/30 rounded-xl border border-rose-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Leave Type</p>
                  <p className="text-lg font-black text-rose-600">{pendingLeaveAssignment.shift}</p>
                </div>
                <div className="p-4 bg-slate-100/30 rounded-xl border border-slate-200/20">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mb-2">Date</p>
                  <p className="text-lg font-black text-slate-800">{new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            
            <div className="p-8 pt-4 flex gap-4">
              <button 
                onClick={handleLeaveCancel}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:bg-rose-50/40 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleLeaveConfirm}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-rose-600 text-white hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20 active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RosterPage;

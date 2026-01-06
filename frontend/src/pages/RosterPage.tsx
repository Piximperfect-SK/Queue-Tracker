import React, { useState, useEffect, useRef } from 'react';
import { MOCK_AGENTS, SHIFTS, MOCK_ROSTER } from '../data/mockData';
import { Calendar as CalendarIcon, GripVertical, FileSpreadsheet, Plus, X, Trash2, FileText, Database } from 'lucide-react';
import type { Agent, RosterEntry, ShiftType } from '../types';
import * as XLSX from 'xlsx';
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
  '6AM-3PM', '1PM-10PM', '2PM-11PM', '10PM-7AM', 
  'WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'
];

const getShiftColor = (shift: string) => {
  switch (shift) {
    case '6AM-3PM': return { bg: 'bg-sky-400', text: 'text-sky-700', light: 'bg-sky-50', border: 'border-sky-100' };
    case '1PM-10PM': return { bg: 'bg-yellow-400', text: 'text-yellow-700', light: 'bg-yellow-50', border: 'border-yellow-100' };
    case '2PM-11PM': return { bg: 'bg-orange-300', text: 'text-orange-700', light: 'bg-orange-50', border: 'border-orange-100' };
    case '10PM-7AM': return { bg: 'bg-slate-700', text: 'text-slate-700', light: 'bg-slate-100', border: 'border-slate-200' };
    case 'EL':
    case 'PL':
    case 'UL':
    case 'MID-LEAVE': return { bg: 'bg-red-600', text: 'text-red-600', light: 'bg-red-50', border: 'border-red-100' };
    default: return { bg: 'bg-slate-200', text: 'text-slate-400', light: 'bg-slate-50', border: 'border-slate-100' };
  }
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
      className={`${className} ${isOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50/30' : ''} transition-all duration-200`}
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
}

const SortableAgent: React.FC<SortableAgentProps> = ({ agent, shift, colors, onShiftChange }) => {
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
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-3 hover:${colors.light} rounded-xl transition-all group border border-transparent hover:border-${colors.border} bg-white shadow-sm mb-2`}
    >
      <div className="flex items-center space-x-3">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors">
          <GripVertical size={16} />
        </div>
        <div className={`w-10 h-10 ${colors.bg} rounded-xl flex items-center justify-center text-white text-sm font-black shadow-sm`}>
          {agent.name.charAt(0)}
        </div>
        <div>
          <span className="text-gray-900 font-black text-sm block leading-tight">{agent.name}</span>
          {agent.isQH && (
            <span className="text-[9px] font-black text-green-600 uppercase tracking-tighter">Quality Handler</span>
          )}
        </div>
      </div>
      <div className="flex items-center">
        <select 
          value={shift}
          onChange={(e) => onShiftChange(agent.id, e.target.value as ShiftType)}
          className={`text-[10px] font-black bg-transparent border-none focus:ring-0 ${colors.text} cursor-pointer outline-none opacity-0 group-hover:opacity-100 transition-opacity`}
        >
          {ALL_SHIFT_TYPES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </li>
  );
};

const RosterPage: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleAgents = (data: any) => {
      if (data) {
        setAgents(data);
        localStorage.setItem('agents', JSON.stringify(data));
      }
    };
    const handleRoster = (data: any) => {
      if (data) {
        setRoster(data);
        localStorage.setItem('roster', JSON.stringify(data));
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
        setRoster(db.roster);
        localStorage.setItem('roster', JSON.stringify(db.roster));
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
    if (savedRoster) setRoster(JSON.parse(savedRoster));
    else setRoster(MOCK_ROSTER);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Read as 2D array (header: 1 ensures we get a simple array of arrays)
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
        console.log('Raw Excel Data:', data);

        if (data.length < 2 || data[0].length < 2) {
          alert('File structure incorrect. Need Dates in Row 1 and Agents in Column A.');
          return;
        }

        // 1. Map Dates from the first row (Row 0), starting from Column B (Index 1)
        const dateMap: { [colIdx: number]: string } = {};
        const firstRow = data[0];
        for (let j = 1; j < firstRow.length; j++) {
          let val = firstRow[j];
          if (!val) continue;

          let dateStr = '';
          if (val instanceof Date) {
            dateStr = val.toISOString().split('T')[0];
          } else {
            // Try parsing string dates like "3rd January 2026"
            const cleanVal = String(val).replace(/(\d+)(st|nd|rd|th)/, '$1');
            const d = new Date(cleanVal);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString().split('T')[0];
            }
          }
          if (dateStr) dateMap[j] = dateStr;
        }

        console.log('Detected Dates:', dateMap);

        // 2. Map Agents from the first column (Column 0) and process shifts
        const newEntries: RosterEntry[] = [];
        const unmatchedAgents = new Set<string>();

        // Start from Row 1 to check all rows for agent names
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row || !row[0]) continue;

          const agentName = String(row[0]).trim();
          // Skip header-like rows
          if (agentName.toLowerCase().includes('names/dates') || 
              agentName.toLowerCase() === 'saturday' || 
              agentName.toLowerCase() === 'sunday' ||
              agentName.toLowerCase() === 'monday' ||
              agentName.toLowerCase() === 'tuesday' ||
              agentName.toLowerCase() === 'wednesday' ||
              agentName.toLowerCase() === 'thursday' ||
              agentName.toLowerCase() === 'friday') continue;

          const agent = agents.find(a => 
            a.name.toLowerCase().replace(/\s+/g, '') === agentName.toLowerCase().replace(/\s+/g, '')
          );

          if (!agent) {
            unmatchedAgents.add(agentName);
            continue;
          }

          // For this agent, check every column that has a date
          Object.keys(dateMap).forEach(colIdxStr => {
            const j = parseInt(colIdxStr);
            const date = dateMap[j];
            const shiftValue = row[j];

            if (date && shiftValue !== null && shiftValue !== undefined) {
              let shift: ShiftType = 'WO';
              const val = String(shiftValue).toUpperCase();

              if (val.includes('06:00 AM')) shift = '6AM-3PM';
              else if (val.includes('01:00 PM')) shift = '1PM-10PM';
              else if (val.includes('02:00 PM')) shift = '2PM-11PM';
              else if (val.includes('10:00 PM')) shift = '10PM-7AM';
              else if (val === 'WO' || val === 'CO' || val === 'OFF') shift = 'WO';
              
              newEntries.push({
                agentId: agent.id,
                date: date,
                shift: shift
              });
            }
          });
        }

        if (newEntries.length > 0) {
          const updatedRoster = [...roster];
          newEntries.forEach(entry => {
            const idx = updatedRoster.findIndex(r => r.agentId === entry.agentId && r.date === entry.date);
            if (idx > -1) updatedRoster[idx] = entry;
            else updatedRoster.push(entry);
          });

          setRoster(updatedRoster);
          localStorage.setItem('roster', JSON.stringify(updatedRoster));
          syncData.updateRoster(updatedRoster);
          
          addLog('Excel Import', `Imported ${newEntries.length} entries for ${Array.from(new Set(newEntries.map(e => e.agentId))).length} agents.`);
          
          let msg = `Imported ${newEntries.length} entries.`;
          if (unmatchedAgents.size > 0) {
            msg += `\n\nAgents not found: ${Array.from(unmatchedAgents).join(', ')}`;
          }
          alert(msg);
        } else {
          alert('No data imported. Ensure:\n1. Row 1 has dates (B1, C1...)\n2. Column A has Agent Names (A3, A4...)\n3. Names match exactly.');
        }
      } catch (err) {
        console.error('Import Error:', err);
        alert('Error processing file.');
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddAgent = () => {
    if (!newAgentName.trim()) return;

    const newAgent: Agent = {
      id: Date.now().toString(),
      name: newAgentName.trim(),
      isQH: false
    };

    const updatedAgents = [...agents, newAgent];
    setAgents(updatedAgents);
    localStorage.setItem('agents', JSON.stringify(updatedAgents));
    syncData.updateAgents(updatedAgents);
    addLog('Add Agent', `Added new agent: ${newAgent.name}`);
    setNewAgentName('');
    setIsModalOpen(false);
  };

  const updateShift = (agentId: string, shift: ShiftType) => {
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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const agentId = active.id as string;
    const overId = over.id as string;

    if (SHIFTS.includes(overId as any)) {
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
    else if (overId === 'TRASH') {
      // Delete agent globally
      const agentToDelete = agents.find(a => a.id === agentId);
      const updatedAgents = agents.filter(a => a.id !== agentId);
      const updatedRoster = roster.filter(r => r.agentId !== agentId);
      
      setAgents(updatedAgents);
      setRoster(updatedRoster);
      
      localStorage.setItem('agents', JSON.stringify(updatedAgents));
      localStorage.setItem('roster', JSON.stringify(updatedRoster));
      syncData.updateAgents(updatedAgents);
      syncData.updateRoster(updatedRoster);
      addLog('Delete Agent', `Permanently deleted agent: ${agentToDelete?.name || agentId}`);
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
  const activeAgentShift = activeId ? roster.find(r => r.agentId === activeId && r.date === selectedDate)?.shift || 'Unassigned' : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      {/* Header - Compact */}
      <div className="px-6 py-3 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none">Service Desk Roster</h1>
          <div className="h-6 w-px bg-gray-200 hidden md:block"></div>
          <p className="text-xs text-gray-500 font-medium hidden md:block uppercase tracking-wider">Shift Management</p>
        </div>
        
        <div className="flex items-center space-x-3">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button 
            onClick={() => downloadLogsForDate(selectedDate)}
            className="flex items-center space-x-2 bg-white border border-gray-200 hover:border-blue-400 hover:text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-sm group"
            title="Download logs for selected date"
          >
            <FileText size={14} className="text-blue-600" />
            <span>Logs</span>
          </button>
          <button 
            onClick={() => downloadAllLogs()}
            className="flex items-center space-x-2 bg-white border border-gray-200 hover:border-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-sm group"
            title="Download full audit history"
          >
            <Database size={14} className="text-slate-500" />
            <span>All</span>
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 bg-white border border-gray-200 hover:border-blue-400 hover:text-blue-600 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all shadow-sm group"
          >
            <FileSpreadsheet size={14} className="text-green-600 group-hover:text-blue-600" />
            <span>Import Excel</span>
          </button>

          <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 shadow-inner w-fit">
            <CalendarIcon size={14} className="text-blue-500 mr-2" />
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="outline-none bg-transparent text-gray-700 text-[11px] font-black uppercase tracking-widest"
            />
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex overflow-hidden p-4 gap-4">
          {/* Main Roster Area (3/4) */}
          <div className="w-3/4 flex flex-col gap-4 overflow-hidden">
            {/* Shifts Grid - Fixed Height */}
            <div className="grid grid-cols-4 gap-4 h-2/3">
              {SHIFTS.map((shift) => {
                const colors = getShiftColor(shift);
                const shiftAgents = getAgentsForShift(shift);
                return (
                  <div key={shift} className={`bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200 flex flex-col`}>
                    <div className={`${colors.light} border-b border-gray-100 px-3 py-2 flex justify-between items-center shrink-0`}>
                      <span className={`text-[10px] font-black ${colors.text} uppercase tracking-widest`}>{shift}</span>
                      <span className={`text-[9px] font-black ${colors.text} bg-white/80 px-1.5 py-0.5 rounded border ${colors.border}`}>
                        {shiftAgents.length}
                      </span>
                    </div>
                    <DroppableContainer id={shift} className="p-2 grow overflow-y-auto scrollbar-hide">
                      <SortableContext
                        id={shift}
                        items={shiftAgents.map(a => a.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="space-y-1 h-full">
                          {shiftAgents.map(agent => (
                            <SortableAgent 
                              key={agent.id} 
                              agent={agent} 
                              shift={shift} 
                              colors={colors} 
                              onShiftChange={updateShift}
                            />
                          ))}
                          {shiftAgents.length === 0 && (
                            <li className="flex items-center justify-center h-full text-gray-300 italic text-[10px]">Empty</li>
                          )}
                        </ul>
                      </SortableContext>
                    </DroppableContainer>
                  </div>
                );
              })}
            </div>

            {/* Off Duty Section - Fixed Height */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-1/3 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Off Duty / Leave / Emergency</h2>
                <span className="bg-red-50 text-red-600 text-[9px] font-black px-2 py-0.5 rounded border border-red-100">
                  {getOffDutyAgents().length} Agents
                </span>
              </div>
              <DroppableContainer id="OFF_DUTY" className="p-3 grow overflow-y-auto scrollbar-hide">
                <SortableContext
                  id="OFF_DUTY"
                  items={getOffDutyAgents().map(item => item.agent.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid grid-cols-4 gap-2 h-full">
                    {getOffDutyAgents().map(({ agent, reason }) => {
                      const colors = getShiftColor(reason);
                      return (
                        <SortableAgent 
                          key={agent.id} 
                          agent={agent} 
                          shift={reason} 
                          colors={colors} 
                          onShiftChange={updateShift}
                        />
                      );
                    })}
                    {getOffDutyAgents().length === 0 && (
                      <div className="col-span-full flex items-center justify-center h-full text-gray-300 italic text-[10px]">All agents on duty</div>
                    )}
                  </div>
                </SortableContext>
              </DroppableContainer>
            </div>
          </div>

          {/* Sidebar (1/4) */}
          <div className="w-1/4 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Unassigned Pool</h2>
                <span className="bg-blue-50 text-blue-600 text-[9px] font-black px-2 py-0.5 rounded border border-blue-100">
                  {getUnassignedAgents().length}
                </span>
              </div>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="p-1 hover:bg-blue-100 text-blue-600 rounded-md transition-colors"
                title="Add Agent"
              >
                <Plus size={14} />
              </button>
            </div>
            <DroppableContainer id="UNASSIGNED" className="flex-1 p-3 overflow-y-auto scrollbar-hide">
              <SortableContext
                id="UNASSIGNED"
                items={getUnassignedAgents().map(a => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1.5 h-full">
                  {getUnassignedAgents().map(agent => (
                    <SortableAgent 
                      key={agent.id} 
                      agent={agent} 
                      shift="Unassigned" 
                      colors={{ bg: 'bg-blue-400', text: 'text-blue-700', light: 'bg-blue-50', border: 'border-blue-100' }} 
                      onShiftChange={updateShift}
                    />
                  ))}
                  {getUnassignedAgents().length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-8">
                      <p className="text-gray-300 italic text-[10px]">Pool Empty</p>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DroppableContainer>
          </div>
        </div>

        <DragOverlay>
          {activeId && activeAgent ? (
            <div className={`flex items-center justify-between p-2 rounded-lg border-2 border-blue-400 bg-white shadow-2xl scale-105 opacity-90 w-48`}>
              <div className="flex items-center space-x-2">
                <div className={`w-8 h-8 ${getShiftColor(activeAgentShift || '').bg} rounded-lg flex items-center justify-center text-white text-xs font-black shadow-sm`}>
                  {activeAgent.name.charAt(0)}
                </div>
                <div>
                  <span className="text-gray-900 font-black text-xs block leading-tight">{activeAgent.name}</span>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>

        {/* Trash Zone - Appears when dragging */}
        {activeId && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 duration-300">
            <DroppableContainer 
              id="TRASH" 
              className="group flex flex-col items-center justify-center w-32 h-32 rounded-full border-4 border-dashed border-red-200 bg-red-50/50 hover:bg-red-100 hover:border-red-400 transition-all"
            >
              <div className="text-red-400 group-hover:text-red-600 group-hover:scale-110 transition-all">
                <Trash2 size={32} />
              </div>
              <span className="text-[10px] font-black text-red-400 uppercase tracking-widest mt-2">Drop to Delete</span>
            </DroppableContainer>
          </div>
        )}
      </DndContext>

      {/* Add Agent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="text-lg font-black text-gray-900 tracking-tight">Add New Agent</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                Agent Name
              </label>
              <input 
                autoFocus
                type="text" 
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()}
                placeholder="e.g. John Doe"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-blue-500 focus:ring-0 outline-none font-bold text-gray-800 transition-all placeholder:text-gray-300"
              />
            </div>
            <div className="p-6 bg-gray-50/50 border-t border-gray-100 flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-6 py-3 rounded-xl font-black text-sm text-gray-500 hover:bg-gray-100 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddAgent}
                disabled={!newAgentName.trim()}
                className="flex-1 px-6 py-3 rounded-xl font-black text-sm bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
              >
                Add Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RosterPage;

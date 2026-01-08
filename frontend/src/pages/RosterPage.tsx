import React, { useState, useEffect } from 'react';
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
  '6AM-3PM', '1PM-10PM', '2PM-11PM', '10PM-7AM', 
  'WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'
];

const getShiftColor = (shift: string) => {
  switch (shift) {
    case '6AM-3PM': return { bg: 'bg-sky-600', text: 'text-sky-600', light: 'bg-sky-50', border: 'border-sky-200', card: 'bg-sky-200' };
    case '1PM-10PM': return { bg: 'bg-amber-600', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-200', card: 'bg-amber-200' };
    case '2PM-11PM': return { bg: 'bg-orange-600', text: 'text-orange-600', light: 'bg-orange-50', border: 'border-orange-200', card: 'bg-orange-200' };
    case '10PM-7AM': return { bg: 'bg-slate-700', text: 'text-slate-700', light: 'bg-slate-100', border: 'border-slate-300', card: 'bg-slate-400' };
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
      className={`${className} ${isOver ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''} transition-all duration-300 rounded-2xl`}
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
}

const SortableAgent: React.FC<SortableAgentProps> = ({ agent, shift, colors, onShiftChange, onDelete }) => {
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
      className={`flex items-center justify-between px-2 py-1 rounded-lg transition-all group ${colors.card} backdrop-blur-md hover:opacity-90 shadow-md active:scale-[0.98] cursor-default flex-1 min-h-9 mb-0.5 last:mb-0`}
    >
      <div className="flex items-center space-x-2 flex-1 min-w-0">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-black/50 hover:text-black transition-colors shrink-0">
          <GripVertical size={12} />
        </div>
        <div className="truncate flex-1 min-w-0 ml-0">
          <span className="text-black font-semibold text-[12px] block leading-tight truncate">{agent.name}</span>
          {agent.isQH && (
            <span className="text-[7px] font-semibold text-black/70 uppercase tracking-[0.05em] block truncate">QA</span>
          )}
        </div>
      </div>
      <div className="flex items-center shrink-0 gap-2">
        <button
          onClick={handleDelete}
          className="p-1 rounded-md text-red-600 hover:bg-red-500/20 hover:text-red-700 transition-all opacity-0 group-hover:opacity-100"
          title="Delete Agent"
        >
          <Trash2 size={14} />
        </button>
        <select 
          value={shift}
          onChange={(e) => onShiftChange(agent.id, e.target.value as ShiftType)}
          className={`text-[9px] font-black bg-white/20 px-1 py-0.5 rounded-md border-none focus:ring-0 ${colors.text} cursor-pointer outline-none opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest`}
        >
          {ALL_SHIFT_TYPES.map(s => (
            <option key={s} value={s} className="bg-white text-slate-900 font-bold">{s}</option>
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
  const [isLeaveConfirmModalOpen, setIsLeaveConfirmModalOpen] = useState(false);
  const [pendingLeaveAssignment, setPendingLeaveAssignment] = useState<{ agentId: string; shift: ShiftType } | null>(null);

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
    addLog('Delete Agent', `Permanently deleted agent: ${agentToDelete?.name || agentId}`);
  }

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
    <div className="h-full flex flex-col overflow-hidden px-2 pb-2">
      {/* Header - Minimal Light */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <CalendarIcon size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-black tracking-tight leading-none">Roster Control</h1>
            <p className="text-[8px] text-black/60 font-medium uppercase tracking-widest mt-0.5">Personnel Shift Board</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2 bg-transparent p-0">
          <div className="flex gap-1 shrink-0">
            <button 
              onClick={() => downloadLogsForDate(selectedDate)}
              className="p-1.5 rounded-lg text-black hover:bg-black/5 transition-all"
              title="Daily Logs"
            >
              <FileText size={14} />
            </button>
            <button 
              onClick={() => downloadAllLogs()}
              className="p-1.5 rounded-lg text-black hover:bg-black/5 transition-all"
              title="Full Archive"
            >
              <Database size={14} />
            </button>
          </div>

          <div className="flex items-center px-3 py-1.5 gap-2 bg-black/10 rounded-lg border border-black/20">
            <CalendarIcon size={16} className="text-black" />
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="outline-none bg-transparent text-black text-[11px] font-bold uppercase tracking-widest cursor-pointer"
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
        <div className="flex-1 flex overflow-hidden gap-4">
          {/* Main Roster Area */}
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Shifts Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1 overflow-hidden">
              {SHIFTS.map((shift) => {
                const colors = getShiftColor(shift);
                const shiftAgents = getAgentsForShift(shift);
                return (
                  <div key={shift} className="bg-teal-50/40 backdrop-blur-xl rounded-2xl border border-teal-200/30 flex flex-col overflow-hidden group/column shadow-xl">
                    <div className="px-4 py-2 flex justify-between items-center shrink-0 border-b border-teal-200/10 bg-teal-50/20">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${colors.bg}`} />
                        <span className={`text-[9px] font-semibold text-slate-800 uppercase tracking-wide`}>{shift}</span>
                      </div>
                      <span className={`text-[8px] font-semibold text-slate-700 bg-white/60 backdrop-blur-md px-1.5 py-0.5 rounded-full border border-white/30`}>
                        {shiftAgents.length}
                      </span>
                    </div>
                    <DroppableContainer id={shift} className="p-1.5 overflow-y-auto">
                      <SortableContext
                        id={shift}
                        items={shiftAgents.map(a => a.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="flex flex-col gap-0.5">
                          {shiftAgents.map(agent => (
                            <SortableAgent 
                              key={agent.id} 
                              agent={agent} 
                              shift={shift} 
                              colors={colors} 
                              onShiftChange={updateShift}
                              onDelete={deleteAgentGlobally}
                            />
                          ))}
                          {shiftAgents.length === 0 && (
                            <li className="flex flex-col items-center justify-center p-3 opacity-30 shrink-0 border-2 border-dashed border-white/20 rounded-lg">
                              <span className="text-[8px] font-semibold uppercase tracking-tight text-slate-500 italic">No Personnel</span>
                            </li>
                          )}
                        </ul>
                      </SortableContext>
                    </DroppableContainer>
                  </div>
                );
              })}
            </div>

            {/* Leaves & Week Off Section */}
            {getOffDutyAgents().length > 0 && (
              <div className="bg-white/20 backdrop-blur-xl rounded-xl border border-white/30 flex flex-col px-3 py-2 shadow-md">
                <h3 className="text-xs font-semibold text-black uppercase tracking-widest mb-2">Leaves / Week Off</h3>
                <div className="flex flex-wrap gap-1">
                  {getOffDutyAgents().map(({ agent, reason }) => {
                    const colors = getShiftColor(reason);
                    return (
                      <div key={agent.id} className={`${colors.card} px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm`}>
                        <span className="text-black font-semibold text-[11px] truncate">{agent.name}</span>
                        <span className="text-[8px] font-semibold text-black/70 uppercase tracking-tight">{reason}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unassigned Pool Section */}
            <div className="bg-white/20 backdrop-blur-xl rounded-2xl border border-white/30 flex flex-col h-1/4 overflow-hidden shadow-xl">
              <div className="px-5 py-2 border-b border-white/20 bg-white/10 flex items-center justify-between shrink-0">
                <h2 className="text-xs font-semibold text-black uppercase tracking-widest">Unassigned Pool</h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsModalOpen(true)}
                    className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center transition-all shadow-md active:scale-95"
                    title="Add Agent"
                  >
                    <Plus size={16} />
                  </button>
                  <span className="bg-slate-900/20 text-black text-xs font-semibold px-2 py-1 rounded-md uppercase tracking-wider">
                    {getUnassignedAgents().length} Personnel
                  </span>
                </div>
              </div>
              <DroppableContainer id="UNASSIGNED" className="p-2 h-auto max-h-full overflow-auto">
                <SortableContext
                  id="UNASSIGNED"
                  items={getUnassignedAgents().map(a => a.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2 h-auto content-start pb-2">
                    {getUnassignedAgents().map(agent => (
                      <SortableAgent 
                        key={agent.id} 
                        agent={agent} 
                        shift="Unassigned" 
                        colors={{ bg: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-100', border: 'border-blue-200', card: 'bg-blue-200' }} 
                        onShiftChange={updateShift}
                        onDelete={deleteAgentGlobally}
                      />
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

      {/* Light Theme Add Agent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-100 p-6">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="bg-teal-50/60 backdrop-blur-3xl rounded-4xl border border-teal-200/30 shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in duration-200">
            <div className="p-8 pb-4">
              <div className="flex items-center justify-between mb-8">
                <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-teal-200/20">
                  <Plus size={24} className="text-blue-600" />
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-teal-50/40 rounded-full transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Register Personnel</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-8">Add new agent to global database</p>
              
              <div className="space-y-6">
                <div className="group">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1 group-focus-within:text-blue-600 transition-colors">
                    Agent Name
                  </label>
                  <input 
                    autoFocus
                    type="text" 
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()}
                    placeholder="Enter full name"
                    className="w-full px-5 py-4 bg-teal-50/30 backdrop-blur-md border border-teal-200/20 rounded-2xl focus:border-blue-500 focus:bg-teal-50/50 outline-none text-slate-800 font-bold transition-all placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>
            
            <div className="p-8 pt-4 flex gap-4">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 hover:bg-teal-50/40 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddAgent}
                disabled={!newAgentName.trim()}
                className="flex-1 px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 active:scale-95 disabled:opacity-20"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};

export default RosterPage;

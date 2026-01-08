import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_AGENTS, MOCK_ROSTER } from '../data/mockData';
import { ShieldCheck, Calendar as CalendarIcon, PhoneCall, X, Check } from 'lucide-react';
import type { DailyStats, Agent, RosterEntry, ShiftType } from '../types';
import { addLog, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

const getShiftColor = (shift: string) => {
  switch (shift) {
    case '6AM-3PM': return { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50', border: 'border-blue-200', rowBg: 'bg-blue-50/10' };
    case '1PM-10PM': return { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-200', rowBg: 'bg-amber-50/10' };
    case '2PM-11PM': return { bg: 'bg-orange-600', text: 'text-orange-600', light: 'bg-orange-50', border: 'border-orange-200', rowBg: 'bg-orange-50/10' };
    case '10PM-7AM': return { bg: 'bg-slate-700', text: 'text-slate-700', light: 'bg-slate-100', border: 'border-slate-300', rowBg: 'bg-slate-50/10' };
    case '12PM-9PM': return { bg: 'bg-fuchsia-600', text: 'text-fuchsia-600', light: 'bg-fuchsia-50', border: 'border-fuchsia-200', rowBg: 'bg-fuchsia-50/10' };
    case 'EL':
    case 'PL':
    case 'UL':
    case 'MID-LEAVE': return { bg: 'bg-rose-600', text: 'text-rose-600', light: 'bg-rose-50', border: 'border-rose-100', rowBg: 'bg-rose-50/10' };
    default: return { bg: 'bg-slate-500', text: 'text-slate-500', light: 'bg-slate-50', border: 'border-slate-200', rowBg: 'bg-slate-50/10' };
  }
};

interface TrackerPageProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const TrackerPage: React.FC<TrackerPageProps> = ({ selectedDate, setSelectedDate }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [times, setTimes] = useState({ ist: '', uk: '' });

  // Call Modal State
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callData, setCallData] = useState({
    agentId: '',
    ticketNumber: '',
    type: 'New' as 'New' | 'Update'
  });

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

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

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
    const handleStats = (data: any) => {
      if (data) {
        setStats(data);
        localStorage.setItem('stats', JSON.stringify(data));
      }
    };

    socket.on('agents_updated', handleAgents);
    socket.on('roster_updated', handleRoster);
    socket.on('stats_updated', handleStats);
    socket.on('log_added', ({ dateStr, logEntry }) => {
      saveSingleLogFromServer(dateStr, logEntry);
    });
    
    const handleInit = (db: any) => {
      console.log('Received INIT data in TrackerPage');
      if (db.agents) setAgents(db.agents);
      if (db.roster) setRoster(db.roster);
      if (db.stats) setStats(db.stats);
      if (db.logs) saveLogsFromServer(db.logs);
    };

    socket.on('init', handleInit);

    // Initial load from localStorage as fallback
    const savedAgents = localStorage.getItem('agents');
    setAgents(savedAgents ? JSON.parse(savedAgents) : MOCK_AGENTS);

    const savedRoster = localStorage.getItem('roster');
    setRoster(savedRoster ? JSON.parse(savedRoster) : MOCK_ROSTER);

    const savedStats = localStorage.getItem('stats');
    if (savedStats) {
      setStats(JSON.parse(savedStats));
    } else {
      setStats(MOCK_AGENTS.map(agent => ({ 
        agentId: agent.id, 
        date: new Date().toLocaleDateString('en-CA'), 
        incidents: 0, 
        sctasks: 0, 
        calls: 0,
        comments: ''
      })));
    }

    if (socket.connected) {
      socket.emit('get_initial_data');
    }

    return () => {
      socket.off('agents_updated', handleAgents);
      socket.off('roster_updated', handleRoster);
      socket.off('stats_updated', handleStats);
      socket.off('log_added');
      socket.off('init', handleInit);
    };
  }, []);

  const isShiftNearEnd = (shift: ShiftType) => {
    const now = currentTime;
    const todayStr = now.toLocaleDateString('en-CA');
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // If looking at today's date
    if (selectedDate === todayStr) {
      if (shift === '6AM-3PM' && currentMinutes >= 870) return true; // 14:30
      if (shift === '1PM-10PM' && currentMinutes >= 1290) return true; // 21:30
      if (shift === '2PM-11PM' && currentMinutes >= 1350) return true; // 22:30
      if (shift === '12PM-9PM' && currentMinutes >= 1230) return true; // 20:30
      // 10PM-7AM shift on "today" ends tomorrow, so it's not near end yet
    }

    // Handle overnight shift (10PM-7AM)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');

    if (selectedDate === yesterdayStr && shift === '10PM-7AM') {
      if (currentMinutes >= 390) return true; // 06:30 AM today
    }

    // If looking at a past date (older than yesterday), everything is disabled
    if (selectedDate < yesterdayStr) return true;
    
    // If looking at yesterday and it wasn't the overnight shift, it's already ended
    if (selectedDate === yesterdayStr && shift !== '10PM-7AM') return true;

    return false;
  };

  const saveStats = (updatedStats: DailyStats[]) => {
    setStats(updatedStats);
    localStorage.setItem('stats', JSON.stringify(updatedStats));
    syncData.updateStats(updatedStats);
  };

  const activeAgents = useMemo(() => {
    const hiddenShifts = new Set(['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE']);
    const rosterForDay = roster.filter(r => r.date === selectedDate);
    
    const visibleEntries = rosterForDay.filter(r => !hiddenShifts.has(r.shift));

    const all = visibleEntries.map(r => {
      const agent = agents.find(a => a.id === r.agentId);
      if (!agent) return null;
      return {
        ...agent,
        shift: r.shift as ShiftType
      };
    }).filter((a): a is Agent & { shift: ShiftType } => a !== null);

    const shiftOrder: Record<string, number> = {
      '6AM-3PM': 0,
      '12PM-9PM': 1,
      '1PM-10PM': 2,
      '2PM-11PM': 3,
      '10PM-7AM': 4
    };

    return all.sort((a, b) => {
      return (shiftOrder[a.shift] ?? 999) - (shiftOrder[b.shift] ?? 999);
    });
  }, [selectedDate, roster, agents]);

  const updateStat = (agentId: string, field: keyof DailyStats, value: any) => {
    const agent = agents.find(a => a.id === agentId);
    const existing = stats.find(s => s.agentId === agentId && s.date === selectedDate);
    let updated;
    
    const finalValue = (field === 'incidents' || field === 'sctasks' || field === 'calls') 
      ? Number(value) || 0 
      : value;

    const oldValue = existing ? existing[field] : (field === 'comments' ? '' : 0);

    if (existing) {
      updated = stats.map(s => 
        (s.agentId === agentId && s.date === selectedDate) ? { ...s, [field]: finalValue } : s
      );
    } else {
      updated = [...stats, { 
        agentId, 
        date: selectedDate, 
        incidents: 0, 
        sctasks: 0, 
        calls: 0, 
        comments: '',
        [field]: finalValue 
      }];
    }
    
    saveStats(updated);
    
    let type: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (field !== 'comments') {
      const numFinal = Number(finalValue);
      const numOld = Number(oldValue);
      if (numFinal > numOld) type = 'positive';
      else if (numFinal < numOld) type = 'negative';
    }

    addLog('Update Stat', `${agent?.name || agentId} - ${field}: ${oldValue} -> ${finalValue} (Date: ${selectedDate})`, type);
  };

  const handleCallSubmit = () => {
    if (!callData.ticketNumber.trim()) return;
    
    const agent = agents.find(a => a.id === callData.agentId);
    const statsObj = getAgentStats(callData.agentId);
    
    updateStat(callData.agentId, 'calls', statsObj.calls + 1);
    
    // Custom log for the specific call details
    addLog('Call Logged', `${agent?.name}: Ticket #${callData.ticketNumber} (${callData.type})`, 'positive');
    
    // Reset and close
    setCallData({ agentId: '', ticketNumber: '', type: 'New' });
    setIsCallModalOpen(false);
  };

  const getAgentStats = (agentId: string): DailyStats => {
    const s = stats.find(s => s.agentId === agentId && s.date === selectedDate);
    return {
      agentId,
      date: selectedDate,
      incidents: Number(s?.incidents || 0),
      sctasks: Number(s?.sctasks || 0),
      calls: Number(s?.calls || 0),
      comments: s?.comments || ''
    };
  };

  return (
    <div className="h-full flex flex-col gap-0 overflow-hidden p-0 px-2 pb-2 relative">
      {/* Header - Compact Integrated Bar */}
      <div className="mb-3 mt-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl flex justify-between items-center shrink-0 px-5 py-2 shadow-sm">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 shadow-sm">
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-black text-white tracking-tight leading-none uppercase">Personnel Tracker</h1>
              <p className="text-[8px] text-white/40 font-bold uppercase tracking-[0.25em] mt-0.5">Live Performance Board</p>
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
              <span className="text-white font-black text-[10px] uppercase tracking-widest min-w-[80px] text-center">
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
              <span className="text-[12px] font-black text-white uppercase tracking-tighter border-r border-white/10 pr-3">IST</span>
              <span className="text-[15px] font-black text-white tabular-nums tracking-tighter leading-none">{times.ist}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-lg ml-0.5">
              <span className="text-[12px] font-black text-white uppercase tracking-tighter border-r border-white/10 pr-3">GMT</span>
              <span className="text-[15px] font-black text-white tabular-nums tracking-tighter leading-none">{times.uk}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tracker Table - Full Width */}
      <div className="flex-1 flex flex-col min-h-0 bg-white/10 backdrop-blur-2xl rounded-[32px] border border-white/20 shadow-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] font-bold text-white/50 uppercase tracking-widest bg-white/5 border-b border-white/10">
              <th className="px-6 py-4 text-center">Personnel</th>
              <th className="px-6 py-4 text-center">Shift</th>
              <th className="px-6 py-4 text-center">INC</th>
              <th className="px-6 py-4 text-center">TASK</th>
              <th className="px-6 py-4 text-center">CALL</th>
              <th className="px-6 py-4 text-center">Notes</th>
              <th className="px-6 py-4 text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeAgents.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-20">
                  <div className="flex flex-col items-center justify-center opacity-30">
                    <ShieldCheck size={64} strokeWidth={1} className="text-white mb-4" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white">No Personnel Active</p>
                  </div>
                </td>
              </tr>
            ) : activeAgents.map(agent => {
              const agentStats = getAgentStats(agent.id);
              const colors = getShiftColor(agent.shift);
              const rowTotal = agentStats.incidents + agentStats.sctasks + agentStats.calls;
              const isDisabled = isShiftNearEnd(agent.shift);

              return (
                <tr key={agent.id} className={`border-b border-white/5 bg-white/5 backdrop-blur-md hover:bg-white/10 transition-all duration-150 ${isDisabled ? 'opacity-30 grayscale' : ''}`}>
                  <td className="px-4 py-2 text-center">
                    <span className="font-bold text-white text-sm">{agent.name}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-flex px-2.5 py-1 rounded-full font-bold text-[10px] uppercase tracking-wider border border-white/20 ${colors.light} ${colors.text}`}>
                      {agent.shift}
                    </span>
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex items-center justify-center gap-1">
                      <button 
                        onClick={() => updateStat(agent.id, 'incidents', Math.max(0, agentStats.incidents - 1))}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold text-xs text-white">{agentStats.incidents}</span>
                      <button 
                        onClick={() => updateStat(agent.id, 'incidents', agentStats.incidents + 1)}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex items-center justify-center gap-1">
                      <button 
                        onClick={() => updateStat(agent.id, 'sctasks', Math.max(0, agentStats.sctasks - 1))}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold text-xs text-white">{agentStats.sctasks}</span>
                      <button 
                        onClick={() => updateStat(agent.id, 'sctasks', agentStats.sctasks + 1)}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-1 relative">
                    <div className="flex items-center justify-center gap-1">
                      <button 
                        onClick={() => updateStat(agent.id, 'calls', Math.max(0, agentStats.calls - 1))}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50 font-semibold text-xs text-center"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold text-xs text-white">{agentStats.calls}</span>
                      <button 
                        onClick={() => {
                          setCallData(prev => ({ ...prev, agentId: agent.id }));
                          setIsCallModalOpen(true);
                        }}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-blue-500 hover:bg-blue-600 text-white transition-all disabled:opacity-50 font-semibold text-xs shadow-lg shadow-blue-500/20 text-center"
                      >
                        +
                      </button>
                    </div>

                    {/* Popover Call Record - Anchored to Cell */}
                    {isCallModalOpen && callData.agentId === agent.id && (
                      <div className="absolute right-full top-0 mr-4 z-[100] animate-in slide-in-from-right-2 fade-in duration-200">
                        <div className="relative bg-slate-800/90 backdrop-blur-2xl border border-white/20 rounded-[28px] w-[280px] overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-white/10">
                          {/* Header */}
                          <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <div className="flex items-center gap-3">
                              <PhoneCall size={14} className="text-blue-400" />
                              <h3 className="text-white font-black text-[10px] uppercase tracking-widest leading-none">Call Record</h3>
                            </div>
                            <button onClick={() => setIsCallModalOpen(false)} className="text-white/30 hover:text-white transition-colors">
                              <X size={14} />
                            </button>
                          </div>

                          {/* Body */}
                          <div className="p-6 space-y-4">
                            <div className="space-y-2 text-left">
                              <label className="text-[9px] font-black text-white/40 uppercase tracking-widest ml-1">Ticket Number</label>
                              <input 
                                autoFocus
                                type="text"
                                placeholder="..."
                                value={callData.ticketNumber}
                                onChange={(e) => setCallData(prev => ({ ...prev, ticketNumber: e.target.value.toUpperCase() }))}
                                onKeyDown={(e) => e.key === 'Enter' && handleCallSubmit()}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-black text-sm placeholder:text-white/10 focus:outline-none focus:bg-white/10 focus:ring-1 focus:ring-white/30 transition-all uppercase tracking-widest"
                              />
                            </div>

                            <div className="space-y-2 text-left">
                              <label className="text-[9px] font-black text-white/40 uppercase tracking-widest ml-1">Type</label>
                              <div className="grid grid-cols-2 gap-2 p-1 bg-black/20 rounded-xl">
                                <button 
                                  onClick={() => setCallData(prev => ({ ...prev, type: 'New' }))}
                                  className={`py-2 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all ${callData.type === 'New' ? 'bg-white text-slate-900 shadow-lg' : 'text-white/40'}`}
                                >
                                  New
                                </button>
                                <button 
                                  onClick={() => setCallData(prev => ({ ...prev, type: 'Update' }))}
                                  className={`py-2 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all ${callData.type === 'Update' ? 'bg-white text-slate-900 shadow-lg' : 'text-white/40'}`}
                                >
                                  Update
                                </button>
                              </div>
                            </div>

                            <button 
                              onClick={handleCallSubmit}
                              className="w-full bg-white text-slate-900 py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-blue-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Check size={14} strokeWidth={4} className="text-blue-600" />
                              Submit
                            </button>
                          </div>

                          {/* Pointer Triangle */}
                          <div className="absolute top-8 -right-2 w-4 h-4 bg-slate-800 border-r border-t border-white/20 rotate-45" />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input 
                      type="text"
                      placeholder="Note..."
                      disabled={isDisabled}
                      value={agentStats.comments}
                      onChange={(e) => updateStat(agent.id, 'comments', e.target.value)}
                      className="w-full px-2 py-0.5 text-xs text-white bg-white/10 border border-white/20 rounded-lg outline-none focus:bg-white/20 transition-all placeholder:text-white/40 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-3 py-1 text-center">
                    <div className="inline-flex items-center justify-center px-2 py-0.5 bg-white text-slate-900 rounded-lg font-black text-xs min-w-10 shadow-lg shadow-white/10">
                      {rowTotal}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      </div>
    </div>
  );
};

export default TrackerPage;

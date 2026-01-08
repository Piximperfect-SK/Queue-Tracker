import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_AGENTS, MOCK_ROSTER } from '../data/mockData';
import { Plus, Minus, Phone, ShieldCheck, Calendar as CalendarIcon, FileText } from 'lucide-react';
import type { DailyStats, Agent, RosterEntry, ShiftType } from '../types';
import { addLog, downloadLogsForDate, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

const getShiftColor = (shift: string) => {
  switch (shift) {
    case '6AM-3PM': return { bg: 'bg-sky-600', text: 'text-sky-600', light: 'bg-sky-50', border: 'border-sky-100', rowBg: 'bg-sky-50/60' };
    case '1PM-10PM': return { bg: 'bg-amber-600', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-100', rowBg: 'bg-amber-50/60' };
    case '2PM-11PM': return { bg: 'bg-orange-600', text: 'text-orange-600', light: 'bg-orange-50', border: 'border-orange-100', rowBg: 'bg-orange-50/60' };
    case '10PM-7AM': return { bg: 'bg-slate-600', text: 'text-slate-600', light: 'bg-slate-50', border: 'border-slate-100', rowBg: 'bg-slate-50/60' };
    case 'EL':
    case 'PL':
    case 'UL':
    case 'MID-LEAVE': return { bg: 'bg-rose-600', text: 'text-rose-600', light: 'bg-rose-50', border: 'border-rose-100', rowBg: 'bg-rose-50/60' };
    default: return { bg: 'bg-slate-500', text: 'text-slate-500', light: 'bg-slate-50', border: 'border-slate-200', rowBg: 'bg-slate-50/60' };
  }
};

const TrackerPage: React.FC<{ currentUser: string }> = ({ currentUser }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

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
        date: new Date().toISOString().split('T')[0], 
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
    const todayStr = now.toISOString().split('T')[0];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // If looking at today's date
    if (selectedDate === todayStr) {
      if (shift === '6AM-3PM' && currentMinutes >= 870) return true; // 14:30
      if (shift === '1PM-10PM' && currentMinutes >= 1290) return true; // 21:30
      if (shift === '2PM-11PM' && currentMinutes >= 1350) return true; // 22:30
      // 10PM-7AM shift on "today" ends tomorrow, so it's not near end yet
    }

    // Handle overnight shift (10PM-7AM)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

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
      '1PM-10PM': 1,
      '2PM-11PM': 2,
      '10PM-7AM': 3
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
    addLog('Update Stat', `${agent?.name || agentId} - ${field}: ${oldValue} -> ${finalValue} (Date: ${selectedDate})`);
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

  const totals = useMemo(() => {
    const dayStats = activeAgents.map(a => getAgentStats(a.id));
    return dayStats.reduce((acc, curr) => ({
      incidents: acc.incidents + curr.incidents,
      sctasks: acc.sctasks + curr.sctasks,
      calls: acc.calls + curr.calls
    }), { incidents: 0, sctasks: 0, calls: 0 });
  }, [stats, selectedDate, activeAgents]);

  const resetDay = () => {
    if (window.confirm('Are you sure you want to reset all stats for this day?')) {
      const updated = stats.filter(s => s.date !== selectedDate);
      saveStats(updated);
      addLog('Reset Day', `All stats cleared for ${selectedDate}`);
    }
  };

  return (
    <div className="h-full flex flex-col gap-0 overflow-hidden p-0">
      {/* Tracker Table - Full Width */}
      <div className="flex-1 flex flex-col min-h-0 bg-white/40 backdrop-blur-xl rounded-[15px] border-none shadow-none overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-slate-600 uppercase tracking-wider bg-white/40 border-b border-white/30">
              <th className="px-3 py-1.5 text-center flex-1">Personnel</th>
              <th className="px-3 py-1.5 text-center flex-1">Shift</th>
              <th className="px-3 py-1.5 text-center flex-1">INC</th>
              <th className="px-3 py-1.5 text-center flex-1">TASK</th>
              <th className="px-3 py-1.5 text-center flex-1">CALL</th>
              <th className="px-3 py-1.5 text-center flex-1">Notes</th>
              <th className="px-3 py-1.5 text-center flex-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeAgents.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center opacity-40">
                    <ShieldCheck size={48} strokeWidth={1} className="text-slate-400 mb-2" />
                    <p className="text-base font-semibold uppercase tracking-wider text-slate-500">No Personnel</p>
                  </div>
                </td>
              </tr>
            ) : activeAgents.map(agent => {
              const agentStats = getAgentStats(agent.id);
              const colors = getShiftColor(agent.shift);
              const rowTotal = agentStats.incidents + agentStats.sctasks + agentStats.calls;
              const isDisabled = isShiftNearEnd(agent.shift);

              return (
                <tr key={agent.id} className={`border-b border-white/20 ${colors.rowBg} backdrop-blur-sm hover:opacity-80 transition-all duration-150 ${isDisabled ? 'opacity-50 grayscale' : ''}`}>
                  <td className="px-2 py-0.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-bold text-slate-900 text-sm">{agent.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-md font-semibold text-[11px] uppercase border ${colors.border} ${colors.light} ${colors.text}`}>
                      {agent.shift}
                    </span>
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex items-center justify-center gap-1">
                      <button 
                        onClick={() => updateStat(agent.id, 'incidents', Math.max(0, agentStats.incidents - 1))}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-700 hover:text-rose-600 transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-semibold text-xs text-slate-900">{agentStats.incidents}</span>
                      <button 
                        onClick={() => updateStat(agent.id, 'incidents', agentStats.incidents + 1)}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-700 hover:text-blue-600 transition-all disabled:opacity-50 font-semibold text-xs"
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
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-700 hover:text-rose-600 transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-semibold text-xs text-slate-900">{agentStats.sctasks}</span>
                      <button 
                        onClick={() => updateStat(agent.id, 'sctasks', agentStats.sctasks + 1)}
                        disabled={isDisabled}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-700 hover:text-indigo-600 transition-all disabled:opacity-50 font-semibold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-1">
                    <input 
                      disabled={isDisabled}
                      type="number" 
                      min="0"
                      value={agentStats.calls}
                      onChange={(e) => updateStat(agent.id, 'calls', parseInt(e.target.value) || 0)}
                      className="w-9 px-1 py-0.5 text-center font-semibold text-xs text-slate-900 bg-slate-200 border border-slate-300 rounded-lg outline-none focus:bg-white focus:border-blue-400 transition-all disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input 
                      type="text"
                      placeholder="Note..."
                      disabled={isDisabled}
                      value={agentStats.comments}
                      onChange={(e) => updateStat(agent.id, 'comments', e.target.value)}
                      className="w-full px-2 py-0.5 text-xs text-slate-800 bg-slate-200 border border-slate-300 rounded-lg outline-none focus:bg-white focus:border-blue-400 transition-all placeholder:text-slate-400 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-3 py-1 text-center">
                    <div className="inline-flex items-center justify-center px-2 py-0.5 bg-blue-600 text-white rounded-lg font-semibold text-xs min-w-[40px] shadow-md shadow-blue-600/20">
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

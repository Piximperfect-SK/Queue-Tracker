import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_AGENTS, MOCK_ROSTER } from '../data/mockData';
import { Plus, Minus, Phone, ShieldCheck, Calendar as CalendarIcon, FileText } from 'lucide-react';
import type { DailyStats, Agent, RosterEntry, ShiftType } from '../types';
import { addLog, downloadLogsForDate, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

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

const TrackerPage: React.FC = () => {
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

  const { activeAgents, offlineAgents } = useMemo(() => {
    const offDutyTypes = ['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE'];
    const rosterForDay = roster.filter(r => r.date === selectedDate);
    
    const all = rosterForDay.map(r => {
      const agent = agents.find(a => a.id === r.agentId);
      if (!agent) return null;
      return {
        ...agent,
        shift: r.shift as ShiftType,
        isOffline: offDutyTypes.includes(r.shift)
      };
    }).filter((a): a is (Agent & { shift: ShiftType; isOffline: boolean }) => a !== null);

    return {
      activeAgents: all.filter(a => !a.isOffline),
      offlineAgents: all.filter(a => a.isOffline)
    };
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
    <div className="p-2 max-w-screen-2xl mx-auto h-full flex flex-col overflow-hidden box-border">
      <div className="flex flex-col lg:flex-row justify-between items-end mb-2 gap-4 shrink-0">
        <div className="flex items-end space-x-6">
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none mb-1.5">Daily Queue Tracker</h1>
            <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1 shadow-sm w-fit">
              <CalendarIcon size={14} className="text-blue-500 mr-2" />
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="outline-none text-gray-700 text-xs font-bold uppercase tracking-wider"
              />
            </div>
          </div>
          <button 
            onClick={resetDay}
            className="mb-0.5 px-2 py-1 text-[9px] font-black text-red-500 hover:bg-red-50 rounded-lg uppercase tracking-widest transition-all border border-red-100 hover:border-red-200 shadow-sm"
          >
            Reset Day
          </button>
          <button 
            onClick={() => downloadLogsForDate(selectedDate)}
            className="mb-0.5 px-2 py-1 text-[9px] font-black text-blue-500 hover:bg-blue-50 rounded-lg uppercase tracking-widest transition-all border border-blue-100 hover:border-blue-200 shadow-sm flex items-center gap-1"
          >
            <FileText size={10} />
            Download Logs
          </button>
        </div>
        
        <div className="flex gap-2">
          <div className="bg-white border border-blue-100 px-3 py-1.5 rounded-xl shadow-sm flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
              <Plus size={16} />
            </div>
            <div>
              <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Incidents</p>
              <p className="text-xl font-black text-gray-900 leading-none">{totals.incidents}</p>
            </div>
          </div>
          <div className="bg-white border border-indigo-100 px-3 py-1.5 rounded-xl shadow-sm flex items-center space-x-3">
            <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
              <ShieldCheck size={16} />
            </div>
            <div>
              <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">SCTASKs</p>
              <p className="text-xl font-black text-gray-900 leading-none">{totals.sctasks}</p>
            </div>
          </div>
          <div className="bg-white border border-purple-100 px-3 py-1.5 rounded-xl shadow-sm flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600">
              <Phone size={14} />
            </div>
            <div>
              <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Calls</p>
              <p className="text-xl font-black text-gray-900 leading-none">{totals.calls}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="overflow-y-auto flex-1 scrollbar-hide">
          <table className="w-full text-left border-collapse table-fixed min-h-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr className="text-[10px] uppercase text-gray-500 font-black tracking-widest border-b border-gray-200">
                <th className="px-4 py-2 w-[18%]">Agent</th>
                <th className="px-4 py-2 w-[10%]">Shift</th>
                <th className="px-4 py-2 text-center w-[12%]">Incident</th>
                <th className="px-4 py-2 text-center w-[12%]">SCTASK</th>
                <th className="px-4 py-2 text-center w-[10%]">Calls</th>
                <th className="px-4 py-2 w-[28%]">Comments</th>
                <th className="px-4 py-2 text-right w-[10%]">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeAgents.map(agent => {
                const agentStats = getAgentStats(agent.id);
                const colors = getShiftColor(agent.shift);
                const rowTotal = agentStats.incidents + agentStats.sctasks + agentStats.calls;
                const isDisabled = isShiftNearEnd(agent.shift);

                return (
                  <tr key={agent.id} className={`hover:bg-blue-50/20 transition-colors group ${colors.light} ${isDisabled ? 'opacity-75' : ''}`}>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center space-x-2">
                        <div className="truncate">
                          <p className="font-bold text-gray-900 text-sm leading-tight truncate">{agent.name}</p>
                          {agent.isQH && (
                            <div className="flex items-center text-[8px] font-black text-green-600 uppercase mt-0.5">
                              <ShieldCheck size={7} className="mr-1" />
                              QH
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase border inline-block ${colors.bg} text-white border-transparent`}>
                        {agent.shift}
                      </span>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className={`flex items-center justify-center bg-gray-100/50 rounded-lg p-0.5 w-fit mx-auto border border-gray-200/50 ${isDisabled ? 'bg-gray-200/30' : ''}`}>
                        <button 
                          disabled={isDisabled}
                          onClick={() => updateStat(agent.id, 'incidents', Math.max(0, agentStats.incidents - 1))}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center font-black text-sm text-gray-900">{agentStats.incidents}</span>
                        <button 
                          disabled={isDisabled}
                          onClick={() => updateStat(agent.id, 'incidents', agentStats.incidents + 1)}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-green-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className={`flex items-center justify-center bg-gray-100/50 rounded-lg p-0.5 w-fit mx-auto border border-gray-200/50 ${isDisabled ? 'bg-gray-200/30' : ''}`}>
                        <button 
                          disabled={isDisabled}
                          onClick={() => updateStat(agent.id, 'sctasks', Math.max(0, agentStats.sctasks - 1))}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center font-black text-sm text-gray-900">{agentStats.sctasks}</span>
                        <button 
                          disabled={isDisabled}
                          onClick={() => updateStat(agent.id, 'sctasks', agentStats.sctasks + 1)}
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-green-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex justify-center">
                        <input 
                          disabled={isDisabled}
                          type="number" 
                          min="0"
                          value={agentStats.calls}
                          onChange={(e) => updateStat(agent.id, 'calls', parseInt(e.target.value) || 0)}
                          className="w-14 px-2 py-1 bg-gray-100/50 border border-gray-200/50 rounded-lg text-center font-black text-sm text-gray-900 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <input 
                        type="text"
                        placeholder="Add comments..."
                        value={agentStats.comments}
                        onChange={(e) => updateStat(agent.id, 'comments', e.target.value)}
                        className="w-full px-2 py-1 bg-gray-100/30 border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded-lg text-xs text-gray-700 outline-none transition-all placeholder:text-gray-400"
                      />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <div className="inline-block px-3 py-1 bg-gray-900 text-white rounded-lg text-xs font-black shadow-sm">
                        {rowTotal}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {activeAgents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400 italic text-xs">
                    No active agents found for this date.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-gray-900 text-white">
              <tr className="font-black text-[10px] uppercase tracking-widest">
                <td className="px-4 py-2" colSpan={2}>Grand Total</td>
                <td className="px-4 py-2 text-center">
                  <span className="bg-white/10 px-2 py-1 rounded-md text-sm">{totals.incidents}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  <span className="bg-white/10 px-2 py-1 rounded-md text-sm">{totals.sctasks}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  <span className="bg-white/10 px-2 py-1 rounded-md text-sm">{totals.calls}</span>
                </td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-right">
                  <span className="bg-blue-500 px-3 py-1 rounded-lg text-base shadow-lg shadow-blue-500/20">{totals.incidents + totals.sctasks + totals.calls}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {offlineAgents.length > 0 && (
        <div className="mt-1 bg-gray-50/50 rounded-lg p-1.5 border border-gray-200/50 shrink-0">
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-2">Offline / Leave:</span>
            {offlineAgents.map(agent => {
              const colors = getShiftColor(agent.shift);
              return (
                <div key={agent.id} className="flex items-center space-x-1.5 bg-white px-2 py-0.5 rounded-md border border-gray-100 shadow-sm">
                  <span className="text-gray-700 font-bold text-[10px]">{agent.name}</span>
                  <span className={`text-[7px] font-black px-1 rounded uppercase ${colors.bg} text-white`}>
                    {agent.shift}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackerPage;

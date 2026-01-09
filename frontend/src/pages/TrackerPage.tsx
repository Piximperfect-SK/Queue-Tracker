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
      if (db.agents) setAgents(db.agents);
      if (db.roster) setRoster(db.roster);
      if (db.stats) setStats(db.stats);
      if (db.logs) saveLogsFromServer(db.logs);
    };

    socket.on('init', handleInit);

    const savedAgents = localStorage.getItem('agents');
    setAgents(savedAgents ? JSON.parse(savedAgents) : MOCK_AGENTS);

    const savedRoster = localStorage.getItem('roster');
    setRoster(savedRoster ? JSON.parse(savedRoster) : MOCK_ROSTER);

    const savedStats = localStorage.getItem('stats');
    if (savedStats) {
      setStats(JSON.parse(savedStats));
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

    if (selectedDate === todayStr) {
      if (shift === '6AM-3PM' && currentMinutes >= 870) return true;
      if (shift === '1PM-10PM' && currentMinutes >= 1290) return true;
      if (shift === '2PM-11PM' && currentMinutes >= 1350) return true;
      if (shift === '12PM-9PM' && currentMinutes >= 1230) return true;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');

    if (selectedDate === yesterdayStr && shift === '10PM-7AM') {
      if (currentMinutes >= 390) return true;
    }

    if (selectedDate < yesterdayStr) return true;
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
    
    const statsObj = getAgentStats(callData.agentId);
    updateStat(callData.agentId, 'calls', statsObj.calls + 1);
    
    const agent = agents.find(a => a.id === callData.agentId);
    addLog('Call Logged', `${agent?.name}: Ticket #${callData.ticketNumber} (${callData.type})`, 'positive');
    
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
              <h1 className="text-lg font-semibold text-white tracking-tight leading-none uppercase">Personnel Tracker</h1>
              <p className="text-[8px] text-white/40 font-medium uppercase tracking-[0.25em] mt-0.5">Live Performance Board</p>
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
            
            <div className="flex items-center gap-2 cursor-pointer group px-1 relative text-[10px] font-medium text-white uppercase tracking-widest min-w-[80px] text-center">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
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
      </div>

      {/* Tracker Table Container (Scrollable) */}
      <div className="flex-1 min-h-0 bg-white/10 backdrop-blur-2xl rounded-[32px] border border-white/20 shadow-2xl overflow-hidden relative">
        <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="text-[10px] font-bold text-white/50 uppercase tracking-widest bg-slate-900/80 backdrop-blur-md border-b border-white/10">
                <th className="px-6 py-4">Personnel</th>
                <th className="px-6 py-4 text-center">Shift</th>
                <th className="px-6 py-4 text-center">INC</th>
                <th className="px-6 py-4 text-center">TASK</th>
                <th className="px-6 py-4 text-center">CALL</th>
                <th className="px-6 py-4 text-center">Notes</th>
                <th className="px-6 py-4 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {!activeAgents.length ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center opacity-30">
                    <ShieldCheck size={64} className="mx-auto mb-4 text-white" strokeWidth={1} />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white">No Personnel Active</p>
                  </td>
                </tr>
              ) : activeAgents.map(agent => {
                const agentStats = getAgentStats(agent.id);
                const isDisabled = isShiftNearEnd(agent.shift);
                const rowTotal = agentStats.incidents + agentStats.sctasks + agentStats.calls;

                return (
                  <tr key={agent.id} className={`border-b border-white/5 bg-white/5 backdrop-blur-md hover:bg-white/10 transition-all ${isDisabled ? 'opacity-30 grayscale' : ''}`}>
                    <td className="px-6 py-3">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-white leading-tight">{agent.name}</span>
                        {agent.isQH && (
                          <span className="text-[8px] font-black text-blue-400 uppercase tracking-[0.2em] mt-0.5">Queue Handler</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`inline-flex px-3 py-1 rounded-lg font-black text-[9px] uppercase tracking-widest border border-white/10 ${getShiftColor(agent.shift).light} ${getShiftColor(agent.shift).text} shadow-sm`}>
                        {agent.shift}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button 
                          onClick={() => updateStat(agent.id, 'incidents', Math.max(0, agentStats.incidents - 1))}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50 font-black text-sm border border-white/10 shadow-sm"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-black text-[13px] text-white">{agentStats.incidents}</span>
                        <button 
                          onClick={() => updateStat(agent.id, 'incidents', agentStats.incidents + 1)}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50 font-black text-sm border border-white/10 shadow-sm"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button 
                          onClick={() => updateStat(agent.id, 'sctasks', Math.max(0, agentStats.sctasks - 1))}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50 font-black text-sm border border-white/10 shadow-sm"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-black text-[13px] text-white">{agentStats.sctasks}</span>
                        <button 
                          onClick={() => updateStat(agent.id, 'sctasks', agentStats.sctasks + 1)}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50 font-black text-sm border border-white/10 shadow-sm"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button 
                          onClick={() => updateStat(agent.id, 'calls', Math.max(0, agentStats.calls - 1))}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs text-center border border-white/10"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-black text-[13px] text-white">{agentStats.calls}</span>
                        <button 
                          onClick={() => {
                            setCallData({ ...callData, agentId: agent.id });
                            setIsCallModalOpen(true);
                          }}
                          disabled={isDisabled}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 text-sm text-center font-black border border-blue-400"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input 
                        type="text"
                        placeholder="Log status..."
                        disabled={isDisabled}
                        value={agentStats.comments}
                        onChange={(e) => updateStat(agent.id, 'comments', e.target.value)}
                        className="w-full px-3 py-1.5 text-xs text-white bg-black/20 border border-white/10 rounded-xl outline-none focus:ring-1 focus:ring-white/20 transition-all placeholder:text-white/20 disabled:opacity-50 font-medium"
                      />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <div className="inline-flex items-center justify-center px-3 py-1 bg-white text-slate-900 rounded-lg font-black text-[13px] min-w-[40px] shadow-xl">
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

      {/* Call Modal - Centered Minimal Dark */}
      {isCallModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCallModalOpen(false)} />
          <div className="relative bg-[#1e293b] border border-white/20 rounded-[32px] w-[280px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <div className="flex items-center gap-2">
                <PhoneCall size={14} className="text-blue-400" />
                <h3 className="text-white font-bold text-[10px] uppercase tracking-widest leading-none">Call Record</h3>
              </div>
              <button onClick={() => setIsCallModalOpen(false)} className="text-white/40 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Ticket Number</label>
                  <span className="text-[7px] font-bold text-blue-400 uppercase tracking-widest">Required</span>
                </div>
                <input 
                  autoFocus
                  type="text"
                  placeholder="EX: INC1234567"
                  value={callData.ticketNumber}
                  onChange={(e) => setCallData({...callData, ticketNumber: e.target.value.toUpperCase()})}
                  onKeyDown={(e) => e.key === 'Enter' && handleCallSubmit()}
                  className="w-full bg-slate-900 border border-white/10 rounded-2xl px-4 py-3 text-white font-semibold text-xs placeholder:text-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all uppercase tracking-widest shadow-inner"
                />
              </div>
              <div className="space-y-3">
                <label className="block text-[9px] font-bold text-white/40 uppercase tracking-widest px-1">Call Type</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 rounded-2xl border border-white/5">
                  <button onClick={() => setCallData({...callData, type: 'New'})} className={`py-2 rounded-xl font-bold text-[8px] uppercase tracking-widest transition-all ${callData.type === 'New' ? 'bg-white text-slate-900 shadow-lg' : 'text-white/30 hover:text-white/50'}`}>New</button>
                  <button onClick={() => setCallData({...callData, type: 'Update'})} className={`py-2 rounded-xl font-bold text-[8px] uppercase tracking-widest transition-all ${callData.type === 'Update' ? 'bg-white text-slate-900 shadow-lg' : 'text-white/30 hover:text-white/50'}`}>Update</button>
                </div>
              </div>
              <button 
                onClick={handleCallSubmit}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold text-[10px] uppercase tracking-[0.2em] shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 group"
              >
                <Check size={16} strokeWidth={3} />
                Submit Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackerPage;

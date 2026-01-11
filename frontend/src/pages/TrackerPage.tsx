  import React, { useState, useMemo, useEffect } from 'react';
    import { MOCK_HANDLERS, MOCK_ROSTER } from '../data/mockData';
    import { ShieldCheck, PhoneCall, X, Check } from 'lucide-react';
    import type { DailyStats, Handler, RosterEntry, ShiftType } from '../types';
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
      const [handlers, setHandlers] = useState<Handler[]>([]);
      const [roster, setRoster] = useState<RosterEntry[]>([]);
      const [stats, setStats] = useState<DailyStats[]>([]);
      const [currentTime, setCurrentTime] = useState(new Date());
      const [times, setTimes] = useState({ ist: '', uk: '' });

      // Call Modal State
      const [isCallModalOpen, setIsCallModalOpen] = useState(false);
      const [callData, setCallData] = useState({
        handlerId: '',
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
        const handleHandlers = (data: any) => {
          if (data) {
            setHandlers(data);
            localStorage.setItem('handlers', JSON.stringify(data));
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

        socket.on('handlers_updated', handleHandlers);
        socket.on('roster_updated', handleRoster);
        socket.on('stats_updated', handleStats);
        socket.on('log_added', ({ dateStr, logEntry }) => {
          saveSingleLogFromServer(dateStr, logEntry);
        });
    
        const handleInit = (db: any) => {
          if (db.handlers) setHandlers(db.handlers);
          else if (db.agents) setHandlers(db.agents);
          if (db.roster) setRoster(db.roster);
          if (db.stats) setStats(db.stats);
          if (db.logs) saveLogsFromServer(db.logs);
        };

        socket.on('init', handleInit);

        const savedHandlers = localStorage.getItem('handlers');
        setHandlers(savedHandlers ? JSON.parse(savedHandlers) : MOCK_HANDLERS);

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
          socket.off('handlers_updated', handleHandlers);
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

      const getHandlerStats = (handlerId: string): DailyStats => {
        const s = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
        return {
          handlerId,
          date: selectedDate,
          incidents: Number(s?.incidents || 0),
          sctasks: Number(s?.sctasks || 0),
          calls: Number(s?.calls || 0),
          comments: s?.comments || ''
        };
      };

      const activeHandlers = useMemo(() => {
        const hiddenShifts = new Set(['WO', 'ML', 'PL', 'EL', 'UL', 'CO', 'MID-LEAVE']);
        const rosterForDay = roster.filter(r => r.date === selectedDate);
    
        const visibleEntries = rosterForDay.filter(r => !hiddenShifts.has(r.shift));

        const all = visibleEntries.map(r => {
          const handler = handlers.find(a => a.id === r.handlerId);
          if (!handler) return null;
          return {
            ...handler,
            shift: r.shift as ShiftType
          };
        }).filter((a): a is Handler & { shift: ShiftType } => a !== null);

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
      }, [selectedDate, roster, handlers]);

      const totalStats = useMemo(() => {
        return activeHandlers.reduce((acc, handler) => {
          const s = getHandlerStats(handler.id);
          acc.incidents += s.incidents;
          acc.sctasks += s.sctasks;
          acc.calls += s.calls;
          return acc;
        }, { incidents: 0, sctasks: 0, calls: 0 });
      }, [activeHandlers, stats, selectedDate]);

      const updateStat = (handlerId: string, field: keyof DailyStats, value: any) => {
        const handler = handlers.find(a => a.id === handlerId);
        const existing = stats.find(s => s.handlerId === handlerId && s.date === selectedDate);
        let updated;
    
        const finalValue = (field === 'incidents' || field === 'sctasks' || field === 'calls') 
          ? Number(value) || 0 
          : value;

        const oldValue = existing ? existing[field] : (field === 'comments' ? '' : 0);

        if (existing) {
          updated = stats.map(s => 
            (s.handlerId === handlerId && s.date === selectedDate) ? { ...s, [field]: finalValue } : s
          );
        } else {
          updated = [...stats, { 
            handlerId, 
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

        addLog('Update Stat', `${handler?.name || handlerId} - ${field}: ${oldValue} -> ${finalValue} (Date: ${selectedDate})`, type);
      };

      const handleCallSubmit = () => {
        if (!callData.ticketNumber.trim()) return;
    
        const statsObj = getHandlerStats(callData.handlerId);
        updateStat(callData.handlerId, 'calls', statsObj.calls + 1);
    
        const handler = handlers.find(a => a.id === callData.handlerId);
        addLog('Call Logged', `${handler?.name}: Ticket #${callData.ticketNumber} (${callData.type})`, 'positive');
    
        setCallData({ handlerId: '', ticketNumber: '', type: 'New' });
        setIsCallModalOpen(false);
      };

      return (
        <div className="h-full flex flex-col gap-0 overflow-hidden p-0 px-2 pb-2 relative rounded-4xl shadow-xl border border-white/20">
          <div className="absolute inset-0 bg-white/20 rounded-4xl z-[-1]" />
      
          {/* Header - Compact Integrated Bar - Light Themed */}
          <div className="mb-3 mt-1 bg-white/40 backdrop-blur-xl border border-white/40 rounded-2xl flex justify-between items-center shrink-0 px-5 py-2 shadow-sm">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-4">
                <div className="w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center border border-white/20 shadow-lg">
                  <ShieldCheck size={16} className="text-white" />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-lg font-black text-slate-950 tracking-tight leading-none uppercase">Productivity Tracker</h1>
                  <p className="text-[8px] text-slate-500 font-bold uppercase tracking-[0.25em] mt-0.5">Live Performance Board</p>
                </div>
              </div>

              <div className="h-8 w-px bg-slate-200" />

              {/* Integrated Date Selector */}
              <div className="flex items-center h-8 gap-1 bg-white/20 backdrop-blur-md px-2 rounded-xl border border-slate-200">
                <button 
                  onClick={() => {
                    const [y, m, d] = selectedDate.split('-').map(Number);
                    const dateObj = new Date(y, m - 1, d);
                    dateObj.setDate(dateObj.getDate() - 1);
                    setSelectedDate(dateObj.toLocaleDateString('en-CA'));
                  }}
                  className="p-1 hover:bg-black/5 rounded-lg transition-colors text-slate-400 hover:text-black"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
            
                <div className="flex items-center gap-2 cursor-pointer group px-1 relative text-[10px] font-black text-black uppercase tracking-widest min-w-20 text-center">
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
                  className="p-1 hover:bg-black/5 rounded-lg transition-colors text-slate-400 hover:text-black"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Integrated Time Center */}
              <div className="flex items-center bg-white/20 rounded-xl p-1 border border-slate-200 overflow-hidden ml-2">
                <div className="flex items-center gap-3 px-4 py-1.5 bg-white/60 rounded-lg shadow-sm">
                  <span className="text-[12px] font-black text-blue-600 uppercase tracking-tighter border-r border-slate-200 pr-3">IST</span>
                  <span className="text-[15px] font-black text-black tabular-nums tracking-tighter leading-none">{times.ist}</span>
                </div>
                <div className="flex items-center gap-3 px-4 py-1.5 rounded-lg ml-0.5">
                  <span className="text-[12px] font-black text-amber-600 uppercase tracking-tighter border-r border-slate-200 pr-3">GMT</span>
                  <span className="text-[15px] font-black text-black tabular-nums tracking-tighter leading-none">{times.uk}</span>
                </div>
              </div>
            </div>

            {/* Dynamic Totals Center */}
            <div className="flex items-center bg-white/90 backdrop-blur-xl rounded-2xl border border-white/20 overflow-hidden divide-x divide-slate-200/50 shadow-xl">
              <div className="px-6 py-2 flex flex-col items-center min-w-25">
                <span className="text-[8px] font-black text-slate-900 uppercase tracking-[0.2em] mb-0.5">Total INC</span>
                <span className="text-base font-black text-slate-900 tabular-nums leading-none tracking-tight">{totalStats.incidents}</span>
              </div>
              <div className="px-6 py-2 flex flex-col items-center min-w-25">
                <span className="text-[8px] font-black text-slate-900 uppercase tracking-[0.2em] mb-0.5">Total TASK</span>
                <span className="text-base font-black text-slate-900 tabular-nums leading-none tracking-tight">{totalStats.sctasks}</span>
              </div>
              <div className="px-6 py-2 flex flex-col items-center min-w-25">
                <span className="text-[8px] font-black text-slate-900 uppercase tracking-[0.2em] mb-0.5">Total Calls</span>
                <span className="text-base font-black text-slate-900 tabular-nums leading-none tracking-tight">{totalStats.calls}</span>
              </div>
            </div>
          </div>

          {/* Tracker Table Container (Scrollable) */}
          <div className="flex-1 min-h-0 bg-white/40 backdrop-blur-2xl rounded-4xl border border-white/40 shadow-xl overflow-hidden relative">
            <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="text-[10px] font-black text-black uppercase tracking-widest bg-white/60 backdrop-blur-md border-b border-white/20">
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">On Shift Handlers</th>
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">Shift</th>
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">INC</th>
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">TASK</th>
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">CALL</th>
                    <th className="px-6 py-2.5 text-center border-r border-slate-200">Notes</th>
                    <th className="px-6 py-2.5 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {!activeHandlers.length ? (
                    <tr>
                      <td colSpan={7} className="py-20 text-center opacity-30">
                        <ShieldCheck size={64} className="mx-auto mb-4 text-slate-400" strokeWidth={1} />
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-black">No Handlers on Shift</p>
                      </td>
                    </tr>
                  ) : activeHandlers.map(handler => {
                    const handlerStats = getHandlerStats(handler.id);
                    const isDisabled = isShiftNearEnd(handler.shift);
                    const rowTotal = handlerStats.incidents + handlerStats.sctasks + handlerStats.calls;

                    return (
                      <tr key={handler.id} className={`group border-b border-slate-200 bg-white/20 hover:bg-white/30 transition-all ${isDisabled ? 'opacity-30 grayscale' : ''}`}>
                        <td className="px-6 py-2 text-center min-w-50 border-r border-slate-200">
                          <div className="flex flex-col items-center">
                            <span className="text-lg font-black text-black leading-none whitespace-nowrap select-none">
                              {handler.name}
                            </span>
                            {handler.isQH && (
                              <span className="text-[6px] font-black text-blue-600 uppercase tracking-[0.3em] mt-1">
                                Queue Handler (QH)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-center border-r border-slate-200">
                          <span className={`inline-flex px-3 py-1 rounded-lg font-black text-[10px] uppercase tracking-widest border border-slate-200 ${getShiftColor(handler.shift).light} ${getShiftColor(handler.shift).text} shadow-sm`}>
                            {handler.shift}
                          </span>
                        </td>
                        <td className="px-2 py-2 border-r border-slate-200">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => updateStat(handler.id, 'incidents', Math.max(0, handlerStats.incidents - 1))}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 text-black transition-all disabled:opacity-50 font-black text-xs border border-slate-200"
                            >
                              −
                            </button>
                            <span className="w-5 text-center font-black text-xs text-black">{handlerStats.incidents}</span>
                            <button 
                              onClick={() => updateStat(handler.id, 'incidents', handlerStats.incidents + 1)}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 text-black transition-all disabled:opacity-50 font-black text-xs border border-slate-200"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="px-2 py-2 border-r border-slate-200">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => updateStat(handler.id, 'sctasks', Math.max(0, handlerStats.sctasks - 1))}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 text-black transition-all disabled:opacity-50 font-black text-xs border border-slate-200"
                            >
                              −
                            </button>
                            <span className="w-5 text-center font-black text-xs text-black">{handlerStats.sctasks}</span>
                            <button 
                              onClick={() => updateStat(handler.id, 'sctasks', handlerStats.sctasks + 1)}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 text-black transition-all disabled:opacity-50 font-black text-xs border border-slate-200"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="px-2 py-2 border-r border-slate-200">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => updateStat(handler.id, 'calls', Math.max(0, handlerStats.calls - 1))}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 text-black text-[10px] text-center border border-slate-200"
                            >
                              −
                            </button>
                            <span className="w-5 text-center font-black text-xs text-black">{handlerStats.calls}</span>
                            <button 
                              onClick={() => {
                                setCallData({ ...callData, handlerId: handler.id });
                                setIsCallModalOpen(true);
                              }}
                              disabled={isDisabled}
                              className="w-6 h-6 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 text-xs text-center font-black border border-blue-400"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-r border-slate-200">
                          <input 
                            type="text"
                            placeholder="Log status..."
                            disabled={isDisabled}
                            value={handlerStats.comments}
                            onChange={(e) => updateStat(handler.id, 'comments', e.target.value)}
                            className="w-full px-2 py-1 text-[10px] text-black bg-white/40 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-200 transition-all placeholder:text-slate-400 disabled:opacity-50 font-black"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="inline-flex items-center justify-center px-2 py-0.5 bg-slate-900 text-white rounded-md font-black text-xs min-w-7.5 shadow-lg shadow-slate-900/10">
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

          {/* Call Modal - Light Glassmorphic */}
          {isCallModalOpen && (
            <div className="fixed inset-0 z-300 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-white/40 backdrop-blur-md" onClick={() => setIsCallModalOpen(false)} />
              <div className="relative bg-white/90 border border-white/40 rounded-[40px] w-[320px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.1)] animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-8 pt-8 pb-4 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <PhoneCall size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-slate-950 font-black text-xs uppercase tracking-[0.2em] leading-none">Call Record</h3>
                      <p className="text-[7px] text-slate-500 font-bold uppercase tracking-widest mt-1">Logging productivity...</p>
                    </div>
                  </div>
                  <button onClick={() => setIsCallModalOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all">
                    <X size={20} />
                  </button>
                </div>

                <div className="px-8 pb-10 space-y-8">
                  {/* Ticket Input Section */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Ticket Number</label>
                      <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded-full">Required</span>
                    </div>
                    <div className="relative group">
                      <input 
                        autoFocus
                        type="text"
                        placeholder="EX: INC1234567"
                        value={callData.ticketNumber}
                        onChange={(e) => setCallData({...callData, ticketNumber: e.target.value.toUpperCase()})}
                        onKeyDown={(e) => e.key === 'Enter' && handleCallSubmit()}
                        className="w-full bg-white border border-slate-200 rounded-[20px] px-5 py-4 text-slate-900 font-bold text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all uppercase tracking-widest shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Call Type Section */}
                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] px-1">Call Type</label>
                    <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-[22px] border border-slate-200 shadow-inner">
                      <button 
                        onClick={() => setCallData({...callData, type: 'New'})} 
                        className={`py-3 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] transition-all duration-300 ${callData.type === 'New' ? 'bg-white text-slate-950 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}
                      >
                        New
                      </button>
                      <button 
                        onClick={() => setCallData({...callData, type: 'Update'})} 
                        className={`py-3 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] transition-all duration-300 ${callData.type === 'Update' ? 'bg-white text-slate-950 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}
                      >
                        Update
                      </button>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button 
                    onClick={handleCallSubmit}
                    className="w-full bg-slate-900 hover:bg-black text-white pt-5 pb-5 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-3 group"
                  >
                    <Check size={18} strokeWidth={4} className="group-hover:scale-125 transition-transform" />
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

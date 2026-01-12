import React, { useState, useEffect } from 'react';
import { MOCK_HANDLERS } from '../data/mockData';
import { UserPlus, Trash2, ShieldCheck, FileText, Database, Settings as SettingsIcon, AlertCircle } from 'lucide-react';
import type { Handler } from '../types';
import { addLog, downloadLogsForDate, downloadAllLogs, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

const SettingsPage: React.FC = () => {
  const [handlers, setHandlers] = useState<Handler[]>([]);

  useEffect(() => {
    const handleHandlers = (data: any) => {
      setHandlers(data);
      localStorage.setItem('handlers', JSON.stringify(data));
    };

    socket.on('handlers_updated', handleHandlers);
    socket.on('log_added', ({ dateStr, logEntry }) => {
      saveSingleLogFromServer(dateStr, logEntry);
    });
    socket.on('init', (db) => {
      if ((db.handlers || db.agents) && (db.handlers?.length || db.agents?.length)) {
        const data = db.handlers || db.agents;
        setHandlers(data);
        localStorage.setItem('handlers', JSON.stringify(data));
      }
      if (db.logs) {
        saveLogsFromServer(db.logs);
      }
    });

    // Initial load from localStorage as fallback
    const savedHandlers = localStorage.getItem('handlers');
    if (savedHandlers) setHandlers(JSON.parse(savedHandlers));
    else setHandlers(MOCK_HANDLERS);

    return () => {
      socket.off('handlers_updated', handleHandlers);
      socket.off('init');
    };
  }, []);

  const saveHandlers = (updatedHandlers: Handler[]) => {
    setHandlers(updatedHandlers);
    localStorage.setItem('handlers', JSON.stringify(updatedHandlers));
    syncData.updateHandlers(updatedHandlers);
  };

  const updateHandlerName = (id: string, name: string) => {
    const handler = handlers.find(a => a.id === id);
    const oldName = handler?.name || '';
    const updated = handlers.map(a => a.id === id ? { ...a, name } : a);
    saveHandlers(updated);
    addLog('Update Handler Name', `${oldName} -> ${name}`);
  };

  const toggleQH = (id: string) => {
    const handler = handlers.find(a => a.id === id);
    const updated = handlers.map(a => a.id === id ? { ...a, isQH: !a.isQH } : a);
    saveHandlers(updated);
    addLog('System', `${handler?.name}: ${handler?.isQH ? 'Queue Handler (QH) -> Standard' : 'Standard -> Queue Handler (QH)'}`, !handler?.isQH ? 'positive' : 'neutral');
  };

  const addHandler = () => {
    const newHandler: Handler = {
      id: Date.now().toString(),
      name: 'New Handler',
      isQH: false
    };
    saveHandlers([...handlers, newHandler]);
    addLog('Add Handler', `Added new handler: ${newHandler.name}`, 'positive');
  };

  const deleteHandler = (id: string) => {
    if (window.confirm('Are you sure you want to decommission this handler?')) {
      const handler = handlers.find(a => a.id === id);
      saveHandlers(handlers.filter(a => a.id !== id));
      addLog('Delete Handler', `Removed handler: ${handler?.name || id}`, 'negative');
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden px-4 pb-4">
      {/* Header - Light Minimal */}
      <div className="mb-10 flex flex-col xl:flex-row justify-between items-center gap-6 shrink-0 mt-2">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-[#393E46] rounded-xl flex items-center justify-center shadow-lg shadow-[#393E46]/20">
            <SettingsIcon size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#222831] tracking-tight leading-none uppercase">System Control</h1>
            <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em] mt-1.5">Management & Logistics</p>
          </div>
        </div>
        
        <div className="flex gap-3 w-full xl:w-auto">
          <button 
            onClick={() => downloadLogsForDate(new Date().toISOString().split('T')[0])}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-white/40 backdrop-blur-md border border-white/40 text-slate-600 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/60 transition-all shadow-sm active:scale-95"
          >
            <FileText size={16} className="text-blue-600" />
            <span>Daily Logs</span>
          </button>
          <button 
            onClick={() => downloadAllLogs()}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-white/40 backdrop-blur-md border border-white/40 text-slate-600 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/60 transition-all shadow-sm active:scale-95"
          >
            <Database size={16} className="text-indigo-600" />
            <span>Archive</span>
          </button>
          <button
            onClick={addHandler}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-[#222831] text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#222831]/90 transition-all shadow-lg active:scale-95"
          >
            <UserPlus size={16} />
            <span>Deploy New</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden min-h-0">
        {/* Handler Matrix */}
        <div className="bg-white/40 backdrop-blur-3xl rounded-4xl border border-white/40 overflow-hidden flex flex-col shadow-xl">
          <div className="px-8 py-5 border-b border-slate-100 bg-white/40 shrink-0 flex items-center justify-between">
            <h2 className="text-[10px] font-black text-[#222831] uppercase tracking-widest">Handler Matrix</h2>
            <span className="text-[9px] font-black text-[#00ADB5] bg-black/5 px-2.5 py-1 rounded-full border border-slate-200">
              {handlers.length} Active IDs
            </span>
          </div>
          <div className="overflow-y-auto flex-1 p-6 scrollbar-hide">
            <div className="space-y-4">
              {handlers.map((handler) => (
                <div key={handler.id} className="group bg-white/40 border border-white/40 rounded-2xl p-4 flex items-center justify-between transition-all hover:bg-white/60 hover:border-white/50 shadow-sm backdrop-blur-md">
                  <div className="flex items-center space-x-4 flex-1">
                    {/* Dedicated QH Toggle Button in front of name */}
                    <button 
                      onClick={() => toggleQH(handler.id)}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 border shadow-sm group/btn ${
                        handler.isQH 
                          ? 'bg-[#00ADB5] border-[#00ADB5] text-white shadow-[#00ADB5]/20' 
                          : 'bg-white border-slate-200 text-slate-300 hover:border-[#00ADB5]/60 hover:text-[#00ADB5]'
                      }`}
                      title={handler.isQH ? "Queue Handler (QH)" : "Assign as QH"}
                    >
                      <ShieldCheck size={20} strokeWidth={handler.isQH ? 2.5 : 2} className={handler.isQH ? 'animate-pulse' : ''} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <input 
                        type="text" 
                        value={handler.name}
                        onChange={(e) => updateHandlerName(handler.id, e.target.value)}
                        className="bg-transparent text-slate-950 font-black text-base w-full focus:outline-none focus:text-blue-600 transition-colors placeholder:text-slate-300 uppercase tracking-tight"
                        placeholder="Full Name"
                      />
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-md border ${
                          handler.isQH 
                            ? 'bg-[#00ADB5]/10 text-[#00ADB5] border-[#00ADB5]/20' 
                            : 'bg-black/5 text-slate-400 border-slate-200'
                        }`}>
                          {handler.isQH ? 'Queue Handler (QH)' : 'Standard Handler'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => deleteHandler(handler.id)}
                    className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all ml-2"
                    title="Decommission"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* System Diagnostics / Help */}
        <div className="flex flex-col gap-6 flex-1 overflow-hidden">
          <div className="bg-white/40 backdrop-blur-3xl rounded-4xl border border-white/40 p-8 shadow-xl flex-1 flex flex-col min-h-0">
             <div className="flex items-center gap-3 mb-6 shrink-0">
               <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-700 border border-slate-100">
                 <AlertCircle size={22} />
               </div>
               <h2 className="text-[11px] font-black text-slate-950 uppercase tracking-[0.2em]">Operational Protocol</h2>
             </div>
             <div className="space-y-4 overflow-hidden pr-2 scrollbar-hide">
               <div className="bg-white/60 rounded-2xl p-6 border border-white/40 hover:bg-white/80 transition-all backdrop-blur-md">
                 <p className="text-slate-950 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Automated Synchronization</p>
                 <p className="text-slate-600 text-[12px] leading-relaxed font-bold">Changes broadcast instantly to all connected terminals via the encrypted fleet link.</p>
               </div>
               <div className="bg-white/60 rounded-2xl p-6 border border-white/40 hover:bg-white/80 transition-all backdrop-blur-md">
                 <p className="text-slate-950 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Data Persistence</p>
                 <p className="text-slate-600 text-[12px] leading-relaxed font-bold">Log records are stored centrally. Use archive tools for compliance audits.</p>
               </div>
               <div className="bg-white/60 rounded-2xl p-6 border border-white/40 hover:bg-white/80 transition-all backdrop-blur-md">
                 <p className="text-slate-950 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Hierarchy Level</p>
                 <p className="text-slate-600 text-[12px] leading-relaxed font-bold">Queue Handlers (QH) enable priority identifiers across tracking matrices.</p>
               </div>
             </div>
          </div>

          <div className="bg-white/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/40 p-8 flex flex-col items-center justify-center text-center shadow-2xl shrink-0">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-slate-900/30 mb-4 shrink-0">
              P
            </div>
            <p className="text-slate-950 font-black text-xl tracking-tight mb-1 uppercase">Queue Tracker</p>
            <p className="text-[11px] text-slate-500 font-black uppercase tracking-[0.3em] mb-6">Version 4.0.0-Titanium</p>
            <div className="flex items-center gap-3 px-5 py-2.5 bg-green-500/10 backdrop-blur-md rounded-full border border-green-500/20">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">Engine Status: Nominal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

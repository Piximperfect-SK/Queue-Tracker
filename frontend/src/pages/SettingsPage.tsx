import React, { useState, useEffect } from 'react';
import { MOCK_AGENTS } from '../data/mockData';
import { UserPlus, Trash2, ShieldCheck, FileText, Database, Settings as SettingsIcon, AlertCircle } from 'lucide-react';
import type { Agent } from '../types';
import { addLog, downloadLogsForDate, downloadAllLogs, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';

const SettingsPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const handleAgents = (data: any) => {
      setAgents(data);
      localStorage.setItem('agents', JSON.stringify(data));
    };

    socket.on('agents_updated', handleAgents);
    socket.on('log_added', ({ dateStr, logEntry }) => {
      saveSingleLogFromServer(dateStr, logEntry);
    });
    socket.on('init', (db) => {
      if (db.agents && db.agents.length) {
        setAgents(db.agents);
        localStorage.setItem('agents', JSON.stringify(db.agents));
      }
      if (db.logs) {
        saveLogsFromServer(db.logs);
      }
    });

    // Initial load from localStorage as fallback
    const savedAgents = localStorage.getItem('agents');
    if (savedAgents) setAgents(JSON.parse(savedAgents));
    else setAgents(MOCK_AGENTS);

    return () => {
      socket.off('agents_updated', handleAgents);
      socket.off('init');
    };
  }, []);

  const saveAgents = (updatedAgents: Agent[]) => {
    setAgents(updatedAgents);
    localStorage.setItem('agents', JSON.stringify(updatedAgents));
    syncData.updateAgents(updatedAgents);
  };

  const updateAgentName = (id: string, name: string) => {
    const agent = agents.find(a => a.id === id);
    const oldName = agent?.name || '';
    const updated = agents.map(a => a.id === id ? { ...a, name } : a);
    saveAgents(updated);
    addLog('Update Agent Name', `${oldName} -> ${name}`);
  };

  const toggleQH = (id: string) => {
    const agent = agents.find(a => a.id === id);
    const updated = agents.map(a => a.id === id ? { ...a, isQH: !a.isQH } : a);
    saveAgents(updated);
    addLog('Toggle QH', `${agent?.name}: ${agent?.isQH ? 'QH -> Standard' : 'Standard -> QH'}`);
  };

  const addAgent = () => {
    const newAgent: Agent = {
      id: Date.now().toString(),
      name: 'New Personnel',
      isQH: false
    };
    saveAgents([...agents, newAgent]);
    addLog('Add Agent', `Added new agent: ${newAgent.name}`);
  };

  const deleteAgent = (id: string) => {
    if (window.confirm('Are you sure you want to decommission this personnel?')) {
      const agent = agents.find(a => a.id === id);
      saveAgents(agents.filter(a => a.id !== id));
      addLog('Delete Agent', `Deleted agent: ${agent?.name || id}`);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden px-4 pb-4">
      {/* Header - Light Minimal */}
      <div className="mb-10 flex flex-col xl:flex-row justify-between items-center gap-6 shrink-0 mt-2">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center shadow-lg shadow-slate-800/20">
            <SettingsIcon size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">System Control</h1>
            <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mt-1.5">Management & Logistics</p>
          </div>
        </div>
        
        <div className="flex gap-3 w-full xl:w-auto">
          <button 
            onClick={() => downloadLogsForDate(new Date().toISOString().split('T')[0])}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-white/30 backdrop-blur-md border border-white/20 text-slate-600 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/40 transition-all shadow-sm active:scale-95"
          >
            <FileText size={16} className="text-blue-500" />
            <span>Daily Logs</span>
          </button>
          <button 
            onClick={() => downloadAllLogs()}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-white/30 backdrop-blur-md border border-white/20 text-slate-600 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/40 transition-all shadow-sm active:scale-95"
          >
            <Database size={16} className="text-indigo-500" />
            <span>Archive</span>
          </button>
          <button 
            onClick={addAgent}
            className="flex-1 xl:flex-none flex items-center justify-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <UserPlus size={16} />
            <span>Deploy New</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden min-h-0">
        {/* Personnel Matrix */}
        <div className="bg-teal-50/40 backdrop-blur-3xl rounded-4xl border border-teal-200/30 overflow-hidden flex flex-col shadow-xl">
          <div className="px-8 py-5 border-b border-teal-200/10 bg-teal-50/20 shrink-0 flex items-center justify-between">
            <h2 className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Personnel Matrix</h2>
            <span className="text-[9px] font-black text-blue-700 bg-teal-50/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-teal-200/30">
              {agents.length} Active IDs
            </span>
          </div>
          <div className="overflow-hidden flex-1 p-6 scrollbar-hide">
            <div className="space-y-2">
              {agents.map((agent) => (
                <div key={agent.id} className="group bg-white/30 border border-white/20 rounded-xl p-2.5 flex items-center justify-between transition-all hover:bg-white/50 hover:border-white/40 shadow-sm backdrop-blur-md">
                  <div className="flex items-center space-x-3 flex-1 ml-1">
                    <div className="flex-1 min-w-0 leading-none">
                      <input 
                        type="text" 
                        value={agent.name}
                        onChange={(e) => updateAgentName(agent.id, e.target.value)}
                        className="bg-transparent text-slate-900 font-black text-sm w-full focus:outline-none focus:text-blue-600 transition-colors"
                      />
                      <div className="flex items-center gap-2 mt-0.5">
                        <button 
                          onClick={() => toggleQH(agent.id)}
                          className={`flex items-center space-x-1.5 px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase tracking-widest transition-all ${agent.isQH ? 'bg-green-600/20 text-green-700 border border-green-500/30 backdrop-blur-md' : 'bg-black/5 text-slate-600 border border-black/5 hover:bg-black/10'}`}
                        >
                          <ShieldCheck size={8} />
                          <span>{agent.isQH ? 'Quality Personnel' : 'Standard'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => deleteAgent(agent.id)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* System Diagnostics / Help */}
        <div className="flex flex-col gap-6 flex-1 overflow-hidden">
          <div className="bg-teal-50/60 backdrop-blur-3xl rounded-4xl border border-teal-200/40 p-8 shadow-xl flex-1 flex flex-col min-h-0">
             <div className="flex items-center gap-3 mb-6 shrink-0">
               <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-700 border border-white/30">
                 <AlertCircle size={22} />
               </div>
               <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.2em]">Operational Protocol</h2>
             </div>
             <div className="space-y-4 overflow-hidden pr-2 scrollbar-hide">
               <div className="bg-white/40 rounded-2xl p-6 border border-white/30 hover:bg-white/60 transition-all backdrop-blur-md">
                 <p className="text-slate-900 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Automated Synchronization</p>
                 <p className="text-slate-700 text-[12px] leading-relaxed font-bold">Changes broadcast instantly to all connected terminals via the encrypted fleet link.</p>
               </div>
               <div className="bg-white/40 rounded-2xl p-6 border border-white/30 hover:bg-white/60 transition-all backdrop-blur-md">
                 <p className="text-slate-900 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Data Persistence</p>
                 <p className="text-slate-700 text-[12px] leading-relaxed font-bold">Log records are stored centrally. Use archive tools for compliance audits.</p>
               </div>
               <div className="bg-white/40 rounded-2xl p-6 border border-white/30 hover:bg-white/60 transition-all backdrop-blur-md">
                 <p className="text-slate-900 font-black text-[13px] mb-1.5 uppercase tracking-tighter">Personnel Hierarchy</p>
                 <p className="text-slate-700 text-[12px] leading-relaxed font-bold">Quality Analysts (QH) enable priority identifiers across tracking matrices.</p>
               </div>
             </div>
          </div>

          <div className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] border border-white/50 p-8 flex flex-col items-center justify-center text-center shadow-2xl shrink-0">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-blue-600/30 mb-4 shrink-0">
              Q
            </div>
            <p className="text-slate-900 font-black text-xl tracking-tight mb-1 uppercase">Queue Tracker</p>
            <p className="text-[11px] text-slate-500 font-black uppercase tracking-[0.3em] mb-6">Version 4.0.0-Titanium</p>
            <div className="flex items-center gap-3 px-5 py-2.5 bg-green-500/15 backdrop-blur-md rounded-full border border-green-500/30 shadow-inner">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_12px_rgba(34,197,94,0.6)]" />
              <span className="text-[10px] font-black text-green-800 uppercase tracking-widest">Engine Status: Nominal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

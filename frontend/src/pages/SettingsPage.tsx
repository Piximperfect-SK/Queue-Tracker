import React, { useState, useEffect } from 'react';
import { MOCK_AGENTS } from '../data/mockData';
import { UserPlus, Trash2, ShieldCheck, FileText, Database } from 'lucide-react';
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
      name: 'New Agent',
      isQH: false
    };
    saveAgents([...agents, newAgent]);
    addLog('Add Agent', `Added new agent: ${newAgent.name}`);
  };

  const deleteAgent = (id: string) => {
    const agent = agents.find(a => a.id === id);
    saveAgents(agents.filter(a => a.id !== id));
    addLog('Delete Agent', `Deleted agent: ${agent?.name || id}`);
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto h-full overflow-y-auto scrollbar-hide">
      <div className="flex justify-between items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-none mb-2">Agent Management</h1>
          <p className="text-sm text-gray-500 font-medium">Add, edit, or remove service desk agents</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => downloadLogsForDate(new Date().toISOString().split('T')[0])}
            className="flex items-center space-x-2 bg-white border-2 border-blue-100 text-blue-600 px-4 py-3 rounded-xl font-black text-sm hover:bg-blue-50 transition-all shadow-sm active:scale-95"
          >
            <FileText size={18} />
            <span>Today's Logs</span>
          </button>
          <button 
            onClick={() => downloadAllLogs()}
            className="flex items-center space-x-2 bg-white border-2 border-slate-100 text-slate-600 px-4 py-3 rounded-xl font-black text-sm hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <Database size={18} />
            <span>Full History</span>
          </button>
          <button 
            onClick={addAgent}
            className="flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <UserPlus size={18} />
            <span>Add New Agent</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/50 text-xs uppercase text-gray-400 font-black tracking-widest border-b-2 border-gray-100">
              <th className="px-8 py-5">Agent Name</th>
              <th className="px-8 py-5 text-center">Queue Handler</th>
              <th className="px-8 py-5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {agents.map(agent => (
              <tr key={agent.id} className="hover:bg-blue-50/30 transition-colors group">
                <td className="px-8 py-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 font-black text-sm group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                      {agent.name.charAt(0)}
                    </div>
                    <input 
                      type="text" 
                      value={agent.name}
                      onChange={(e) => updateAgentName(agent.id, e.target.value)}
                      className="flex-1 bg-transparent border-none focus:ring-0 font-black text-gray-800 text-base outline-none placeholder:text-gray-300"
                      placeholder="Enter agent name..."
                    />
                  </div>
                </td>
                <td className="px-8 py-4">
                  <div className="flex justify-center">
                    <button 
                      onClick={() => toggleQH(agent.id)}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all border-2 ${
                        agent.isQH 
                          ? 'bg-green-50 border-green-100 text-green-600' 
                          : 'bg-gray-50 border-gray-100 text-gray-300 hover:border-gray-200'
                      }`}
                    >
                      <ShieldCheck size={20} />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        {agent.isQH ? 'Active QH' : 'Standard'}
                      </span>
                    </button>
                  </div>
                </td>
                <td className="px-8 py-4 text-right">
                  <button 
                    onClick={() => deleteAgent(agent.id)}
                    className="p-3 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                  >
                    <Trash2 size={20} />
                  </button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={3} className="px-8 py-12 text-center text-gray-400 italic font-medium">
                  No agents found. Click "Add New Agent" to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SettingsPage;

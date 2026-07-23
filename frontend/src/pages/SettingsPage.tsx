import React, { useState, useEffect } from 'react';
import { MOCK_HANDLERS } from '../data/mockData';
import { Trash2, ShieldCheck, FileText, Database, Settings as SettingsIcon, AlertCircle, Users, Activity, Server, Plus, X, Check, Edit3 } from 'lucide-react';
import type { Handler } from '../types';
import { addLog, downloadLogsForDate, downloadAllLogs, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';
import ConfirmModal from '../components/ConfirmModal';
import { useRole } from '../auth/RoleContext';

const SettingsPage: React.FC = () => {
  const { role } = useRole();
  const isPrivileged = role === 'admin' || role === 'queue_handler';
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
    setEditingId(null);
  };

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
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

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    const handler = handlers.find(a => a.id === deleteConfirmId);
    saveHandlers(handlers.filter(a => a.id !== deleteConfirmId));
    addLog('Delete Handler', `Removed handler: ${handler?.name || deleteConfirmId}`, 'negative');
    setDeleteConfirmId(null);
  };

  const deleteHandler = (id: string) => {
    setDeleteConfirmId(id);
  };

  const qhCount = handlers.filter(h => h.isQH).length;
  const standardCount = handlers.length - qhCount;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-slate-900 to-slate-700 rounded-2xl flex items-center justify-center shadow-lg shadow-slate-900/20">
            <SettingsIcon size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Settings</h1>
            <p className="text-sm text-slate-500">System control & handler management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isPrivileged && (
            <>
              <button
                onClick={() => downloadLogsForDate(new Date().toISOString().split('T')[0])}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
              >
                <FileText size={16} className="text-blue-600" />
                Daily Logs
              </button>
              <button
                onClick={() => downloadAllLogs()}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
              >
                <Database size={16} className="text-indigo-600" />
                Archive
              </button>
              <button
                onClick={addHandler}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 active:scale-95"
              >
                <Plus size={16} />
                Add Handler
              </button>
            </>
          )}
          {!isPrivileged && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-400">
              <ShieldCheck size={16} />
              View Only
            </div>
          )}
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
            <Users size={22} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{handlers.length}</p>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Handlers</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
            <Activity size={22} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{qhCount}</p>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Queue Handlers (QH)</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
            <Server size={22} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{standardCount}</p>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Standard Handlers</p>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden min-h-0">
        {/* Handler List */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">Handler Matrix</h2>
            <span className="text-xs font-semibold text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
              {handlers.length} active
            </span>
          </div>
          <div className="overflow-y-auto flex-1 p-4 space-y-3 scrollbar-hide">
            {handlers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Users size={48} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No handlers configured</p>
                <p className="text-xs mt-1">Click "Add Handler" to get started</p>
              </div>
            )}
            {handlers.map((handler) => (
              <div
                key={handler.id}
                className="group bg-slate-50/70 border border-slate-200 rounded-xl p-4 flex items-center justify-between hover:bg-slate-50 hover:border-slate-300 transition-all"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <button
                    onClick={() => toggleQH(handler.id)}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all shrink-0 border ${
                      handler.isQH
                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                        : 'bg-white border-slate-200 text-slate-400 hover:border-emerald-400 hover:text-emerald-500'
                    }`}
                    title={handler.isQH ? 'Queue Handler (QH)' : 'Assign as QH'}
                  >
                    <ShieldCheck size={18} strokeWidth={handler.isQH ? 2.5 : 2} />
                  </button>

                  <div className="flex-1 min-w-0">
                    {editingId === handler.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 w-full max-w-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateHandlerName(handler.id, editName);
                            if (e.key === 'Escape') cancelEditing();
                          }}
                        />
                        <button
                          onClick={() => updateHandlerName(handler.id, editName)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg transition-all"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 truncate">{handler.name}</span>
                        <button
                          onClick={() => startEditing(handler.id, handler.name)}
                          className="p-1 text-slate-300 hover:text-slate-500 hover:bg-slate-200 rounded-md transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Edit3 size={13} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                        handler.isQH
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {handler.isQH ? 'QH' : 'Standard'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">ID: {handler.id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => deleteHandler(handler.id)}
                  className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all ml-2 opacity-0 group-hover:opacity-100"
                  title="Decommission"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                <AlertCircle size={18} />
              </div>
              <h2 className="text-sm font-bold text-slate-800">System Info</h2>
            </div>
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-bold text-slate-800 mb-1 uppercase tracking-wide">Sync Status</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-medium text-emerald-700">Connected</span>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-bold text-slate-800 mb-1 uppercase tracking-wide">Auto-Sync</p>
                <p className="text-xs text-slate-600 leading-relaxed">Changes broadcast instantly to all connected terminals via encrypted fleet link.</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-bold text-slate-800 mb-1 uppercase tracking-wide">Persistence</p>
                <p className="text-xs text-slate-600 leading-relaxed">Log records stored centrally. Use archive tools for compliance audits.</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-bold text-slate-800 mb-1 uppercase tracking-wide">QH Priority</p>
                <p className="text-xs text-slate-600 leading-relaxed">Queue Handlers (QH) enable priority identifiers across tracking matrices.</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
            <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-3 shadow-lg shadow-slate-900/20">
              Q
            </div>
            <p className="text-base font-bold text-slate-900 mb-0.5">Queue Tracker</p>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">v4.0.0</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">All Systems Nominal</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Decommission Confirm Modal ── */}
      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        title="Decommission Handler"
        message="Are you sure you want to decommission this handler? This action cannot be undone."
        confirmLabel="Decommission"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default SettingsPage;

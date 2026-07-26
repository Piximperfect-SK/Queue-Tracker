import React, { useState, useEffect } from 'react';
import { MOCK_HANDLERS } from '../data/mockData';
import { Trash2, ShieldCheck, FileText, Database, Settings as SettingsIcon, AlertCircle, Users, Activity, Server, Plus, X, Check, Edit3, Clock } from 'lucide-react';
import type { Handler } from '../types';
import { addLog, downloadLogsForDate, downloadAllLogs, saveLogsFromServer, saveSingleLogFromServer } from '../utils/logger';
import { socket, syncData } from '../utils/socket';
import ConfirmModal from '../components/ConfirmModal';
import { useRole } from '../auth/RoleContext';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import TwoFactorCard from '../components/TwoFactorCard';

const SettingsPage: React.FC = () => {
  const { role, pages, actions } = useRole();
  const isPrivileged = actions.editHandlers;
  const canDownloadLogs = actions.downloadLogs;
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [customShifts, setCustomShifts] = useState<string[]>([]);
  const [newShiftInput, setNewShiftInput] = useState('');

  useEffect(() => {
    const handleHandlers = (data: any) => {
      setHandlers(data);
      localStorage.setItem('handlers', JSON.stringify(data));
    };

    // Load custom shifts from localStorage
    const saved = localStorage.getItem('customShifts');
    if (saved) setCustomShifts(JSON.parse(saved));

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

  const addCustomShift = () => {
    if (!newShiftInput.trim()) return;
    const updated = [...customShifts, newShiftInput.trim()];
    setCustomShifts(updated);
    localStorage.setItem('customShifts', JSON.stringify(updated));
    setNewShiftInput('');
    addLog('Shift Management', `Added new shift: ${newShiftInput.trim()}`, 'positive');
  };

  const removeCustomShift = (shift: string) => {
    const updated = customShifts.filter(s => s !== shift);
    setCustomShifts(updated);
    localStorage.setItem('customShifts', JSON.stringify(updated));
    addLog('Shift Management', `Removed shift: ${shift}`, 'negative');
  };

  const qhCount = handlers.filter(h => h.isQH).length;
  const standardCount = handlers.length - qhCount;

  return (
    <div className="h-full flex flex-col overflow-hidden p-3">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden p-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-slate-900 to-slate-700 rounded-lg flex items-center justify-center shadow-lg shadow-slate-900/20">
            <SettingsIcon size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Settings</h1>
            <p className="text-[11px] text-slate-500">System control & handler management</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canDownloadLogs && (
            <>
              <button
                onClick={() => downloadLogsForDate(new Date().toISOString().split('T')[0])}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
              >
                <FileText size={13} className="text-blue-600" />
                <span className="hidden sm:inline">Daily Logs</span>
              </button>
              <button
                onClick={() => downloadAllLogs()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
              >
                <Database size={13} className="text-indigo-600" />
                <span className="hidden sm:inline">Archive</span>
              </button>
            </>
          )}
          {isPrivileged && (
            <button
              onClick={addHandler}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-semibold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 active:scale-95"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Add Handler</span>
            </button>
          )}
          {!isPrivileged && !canDownloadLogs && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-400">
              <ShieldCheck size={13} />
              <span className="hidden sm:inline">View Only</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3 shrink-0">
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-50 rounded flex items-center justify-center text-blue-600 shrink-0">
            <Users size={16} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-900">{handlers.length}</p>
            <p className="text-[9px] font-medium text-slate-500 uppercase tracking-wide">Handlers</p>
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-50 rounded flex items-center justify-center text-emerald-600 shrink-0">
            <Activity size={16} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-900">{qhCount}</p>
            <p className="text-[9px] font-medium text-slate-500 uppercase tracking-wide">QH</p>
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-50 rounded flex items-center justify-center text-amber-600 shrink-0">
            <Server size={16} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-900">{standardCount}</p>
            <p className="text-[9px] font-medium text-slate-500 uppercase tracking-wide">Standard</p>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 flex-1 overflow-hidden min-h-0">
        {/* Handler List */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-800">Handler Matrix</h2>
            <span className="text-[9px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
              {handlers.length} active
            </span>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-2 scrollbar-hide">
            {handlers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Users size={40} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">No handlers configured</p>
                <p className="text-[9px] mt-0.5">Click "Add Handler" to get started</p>
              </div>
            )}
            {handlers.map((handler) => (
              <div
                key={handler.id}
                className="group bg-slate-50/70 border border-slate-200 rounded-lg p-2.5 flex items-center justify-between hover:bg-slate-50 hover:border-slate-300 transition-all"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => isPrivileged && toggleQH(handler.id)}
                    disabled={!isPrivileged}
                    className={`w-8 h-8 rounded flex items-center justify-center transition-all shrink-0 border ${
                      handler.isQH
                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                        : 'bg-white border-slate-200 text-slate-400 hover:border-emerald-400 hover:text-emerald-500'
                    } ${!isPrivileged ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={isPrivileged ? (handler.isQH ? 'Queue Handler (QH)' : 'Assign as QH') : 'View only'}
                  >
                    <ShieldCheck size={14} strokeWidth={handler.isQH ? 2.5 : 2} />
                  </button>

                  <div className="flex-1 min-w-0">
                    {editingId === handler.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 w-full max-w-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateHandlerName(handler.id, editName);
                            if (e.key === 'Escape') cancelEditing();
                          }}
                        />
                        <button
                          onClick={() => updateHandlerName(handler.id, editName)}
                          className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded transition-all"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-0.5 text-slate-400 hover:bg-slate-200 rounded transition-all"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{handler.name}</span>
                        {isPrivileged && (
                          <button
                            onClick={() => startEditing(handler.id, handler.name)}
                            className="p-0.5 text-slate-300 hover:text-slate-500 hover:bg-slate-200 rounded transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Edit3 size={11} />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        handler.isQH
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {handler.isQH ? 'QH' : 'STD'}
                      </span>
                      <span className="text-[8px] text-slate-400 font-mono">ID: {handler.id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>

                {isPrivileged && (
                  <button
                    onClick={() => deleteHandler(handler.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all ml-1 opacity-0 group-hover:opacity-100"
                    title="Decommission"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-2 overflow-y-auto scrollbar-hide">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-indigo-50 rounded flex items-center justify-center text-indigo-600 border border-indigo-100">
                <ShieldAlert size={14} />
              </div>
              <div>
                <h2 className="text-xs font-bold text-slate-800">Your Access</h2>
                <p className="text-[9px] text-slate-400 capitalize">{role ? role.replace('_', ' ') : 'Unknown role'}</p>
              </div>
            </div>
            <div className="space-y-1">
              {(Object.keys(pages) as (keyof typeof pages)[]).map((key) => (
                <div key={key} className="flex items-center justify-between px-2 py-1 rounded text-[9px] bg-slate-50 border border-slate-100">
                  <span className="font-semibold text-slate-600 capitalize">{key === 'logMonitor' ? 'Log Monitor' : key}</span>
                  <span className={`text-[8px] font-bold uppercase tracking-wide ${pages[key] ? 'text-emerald-600' : 'text-slate-300'}`}>
                    {pages[key] ? 'OK' : 'X'}
                  </span>
                </div>
              ))}
            </div>
            {role === 'admin' && (
              <Link
                to="/admin"
                className="mt-2 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded text-[9px] font-bold hover:bg-slate-800 transition-all shadow-sm active:scale-95"
              >
                Manage Access
              </Link>
            )}
          </div>

          <TwoFactorCard />

          {isPrivileged && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-purple-50 rounded flex items-center justify-center text-purple-600 border border-purple-100">
                  <Clock size={14} />
                </div>
                <h2 className="text-xs font-bold text-slate-800">Shift Management</h2>
              </div>
              <div className="space-y-1">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newShiftInput}
                    onChange={(e) => setNewShiftInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addCustomShift();
                    }}
                    placeholder="e.g., 3PM-12AM"
                    className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                  />
                  <button
                    onClick={addCustomShift}
                    disabled={!newShiftInput.trim()}
                    className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-bold hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"
                  >
                    <Plus size={11} />
                  </button>
                </div>
                {customShifts.length > 0 && (
                  <div className="space-y-0.5 pt-1.5 border-t border-slate-100">
                    {customShifts.map((shift) => (
                      <div key={shift} className="flex items-center justify-between px-2 py-1 bg-purple-50 border border-purple-100 rounded text-xs">
                        <span className="font-semibold text-purple-700">{shift}</span>
                        <button
                          onClick={() => removeCustomShift(shift)}
                          className="p-0.5 text-purple-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-2">Custom shifts appear in all roster views</p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 border border-emerald-100">
                <AlertCircle size={18} />
              </div>
              <h2 className="text-sm font-bold text-slate-800">System Status</h2>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-emerald-700">Live sync connected — changes broadcast instantly</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 text-center">
            <div className="w-11 h-11 bg-slate-900 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-2 shadow-lg shadow-slate-900/20">
              Q
            </div>
            <p className="text-sm font-bold text-slate-900">Queue Tracker</p>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">v4.0.0</p>
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
    </div>
  );
};

export default SettingsPage;

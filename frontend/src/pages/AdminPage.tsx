import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, AlertCircle, Eye, EyeOff, Copy, Check,
  KeyRound, SlidersHorizontal, Shield, Users, ClipboardList,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { authHeaders } from '../utils/authToken';
import type { PagePermissions, ActionPermissions } from '../auth/RoleContext';

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

type Role = 'admin' | 'queue_handler' | 'associate';
const EDITABLE_ROLES: Exclude<Role, 'admin'>[] = ['queue_handler', 'associate'];

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  queue_handler: 'Queue Handler',
  associate: 'Associate / Agent',
};
const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  queue_handler: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  associate: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PAGE_META: { key: keyof PagePermissions; label: string; editable: boolean }[] = [
  { key: 'roster', label: 'Roster', editable: true },
  { key: 'stats', label: 'Tracker / Stats', editable: true },
  { key: 'logMonitor', label: 'Log Monitor', editable: true },
  { key: 'settings', label: 'Settings', editable: true },
  { key: 'admin', label: 'Admin Panel', editable: false },
];
const ACTION_META: { key: keyof ActionPermissions; label: string }[] = [
  { key: 'editRoster', label: 'Edit Roster' },
  { key: 'editHandlers', label: 'Edit Handlers' },
  { key: 'deleteLog', label: 'Delete Log Entries' },
  { key: 'exportData', label: 'Export Data' },
  { key: 'manageUsers', label: 'Manage Users' },
  { key: 'downloadLogs', label: 'Download Logs' },
];

interface CodesState { admin: string | null; queue_handler: string | null; associate: string | null; }
type PermsMap = Record<'queue_handler' | 'associate', { pages: PagePermissions; actions: ActionPermissions } | null>;

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const AdminPage: React.FC = () => {
  const [tab, setTab] = useState<'codes' | 'permissions'>('codes');

  // ---- Access codes state ----
  const [codes, setCodes] = useState<CodesState>({ admin: null, queue_handler: null, associate: null });
  const [revealed, setRevealed] = useState<Record<Role, boolean>>({ admin: false, queue_handler: false, associate: false });
  const [copied, setCopied] = useState<Role | null>(null);
  const [regenTarget, setRegenTarget] = useState<Role | null>(null);
  const [justRegenerated, setJustRegenerated] = useState<{ role: Role; code: string } | null>(null);

  // ---- Permissions state ----
  const [perms, setPerms] = useState<PermsMap>({ queue_handler: null, associate: null });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState<Role | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [codesRes, qhRes, assocRes] = await Promise.all([
        api('/api/access/codes'),
        api('/api/access/permissions/queue_handler'),
        api('/api/access/permissions/associate'),
      ]);
      setCodes(codesRes.codes);
      setPerms({
        queue_handler: { pages: qhRes.pages, actions: qhRes.actions },
        associate: { pages: assocRes.pages, actions: assocRes.actions },
      });
      setDirty({});
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data. Admin privileges required.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ---- Access code actions ----
  const toggleReveal = (role: Role) => setRevealed((r) => ({ ...r, [role]: !r[role] }));

  const copyCode = (role: Role, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(role);
    setTimeout(() => setCopied(null), 1500);
  };

  const executeRegenerate = async () => {
    if (!regenTarget) return;
    const role = regenTarget;
    setRegenTarget(null);
    setError(null);
    try {
      const data = await api(`/api/access/codes/${role}/regenerate`, { method: 'POST' });
      setCodes((c) => ({ ...c, [role]: data.code }));
      setRevealed((r) => ({ ...r, [role]: true }));
      setJustRegenerated({ role, code: data.code });
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate code');
    }
  };

  // ---- Permission actions ----
  const togglePage = (role: 'queue_handler' | 'associate', key: keyof PagePermissions) => {
    setPerms((p) => {
      const current = p[role];
      if (!current) return p;
      return { ...p, [role]: { ...current, pages: { ...current.pages, [key]: !current.pages[key] } } };
    });
    setDirty((d) => ({ ...d, [role]: true }));
  };

  const toggleAction = (role: 'queue_handler' | 'associate', key: keyof ActionPermissions) => {
    setPerms((p) => {
      const current = p[role];
      if (!current) return p;
      return { ...p, [role]: { ...current, actions: { ...current.actions, [key]: !current.actions[key] } } };
    });
    setDirty((d) => ({ ...d, [role]: true }));
  };

  const savePermissions = async (role: 'queue_handler' | 'associate') => {
    const current = perms[role];
    if (!current) return;
    setSavingRole(role);
    setError(null);
    try {
      const data = await api(`/api/access/permissions/${role}`, {
        method: 'PUT',
        body: JSON.stringify({ pages: current.pages, actions: current.actions }),
      });
      setPerms((p) => ({ ...p, [role]: { pages: data.pages, actions: data.actions } }));
      setDirty((d) => ({ ...d, [role]: false }));
    } catch (err: any) {
      setError(err.message || 'Failed to save permissions');
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-900 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-900/20">
            <ShieldCheck size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Access Control</h1>
            <p className="text-sm text-slate-500">Manage role access codes and page/action permissions</p>
          </div>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 mb-6 px-5 py-4 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold text-red-700 shrink-0">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 shrink-0">
        <button
          onClick={() => setTab('codes')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            tab === 'codes' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <KeyRound size={16} />
          Access Codes
        </button>
        <button
          onClick={() => setTab('permissions')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            tab === 'permissions' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal size={16} />
          Role Permissions
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <RefreshCw size={32} className="animate-spin opacity-50" />
          </div>
        ) : tab === 'codes' ? (
          <div className="space-y-4 max-w-3xl">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <ClipboardList size={18} className="shrink-0 mt-0.5" />
              <p>Each role signs in with its own 6-digit access code plus their name. Regenerating a code immediately invalidates the old one — share the new code with everyone using that role before they next log in.</p>
            </div>
            {(['admin', 'queue_handler', 'associate'] as Role[]).map((role) => (
              <div key={role} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-500 border border-slate-100">
                    <Users size={20} />
                  </div>
                  <div>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border mb-1.5 ${ROLE_COLORS[role]}`}>
                      {ROLE_LABELS[role]}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-bold text-slate-900 tracking-[0.2em]">
                        {codes[role] ? (revealed[role] ? codes[role] : '••••••') : '—'}
                      </span>
                      {codes[role] && (
                        <>
                          <button onClick={() => toggleReveal(role)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all" title={revealed[role] ? 'Hide' : 'Reveal'}>
                            {revealed[role] ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                          <button onClick={() => copyCode(role, codes[role]!)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all" title="Copy">
                            {copied === role ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setRegenTarget(role)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                >
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <Shield size={18} className="shrink-0 mt-0.5" />
              <p>Admin always has full access and isn't editable here. Toggle what Queue Handlers and Associates can see and do — changes apply the next time they load a page or attempt an action.</p>
            </div>
            {EDITABLE_ROLES.map((role) => {
              const current = perms[role];
              if (!current) return null;
              return (
                <div key={role} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <span className={`inline-block text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border ${ROLE_COLORS[role]}`}>
                      {ROLE_LABELS[role]}
                    </span>
                    <button
                      onClick={() => savePermissions(role)}
                      disabled={!dirty[role] || savingRole === role}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingRole === role ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                      {dirty[role] ? 'Save Changes' : 'Saved'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Page Access</p>
                      <div className="space-y-2">
                        {PAGE_META.map(({ key, label, editable }) => (
                          <label key={key} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${editable ? 'border-slate-200 hover:bg-slate-50 cursor-pointer' : 'border-slate-100 bg-slate-50/50 opacity-60 cursor-not-allowed'} transition-all`}>
                            <span className="text-sm font-semibold text-slate-700">{label}</span>
                            <input
                              type="checkbox"
                              checked={editable ? current.pages[key] : false}
                              disabled={!editable}
                              onChange={() => editable && togglePage(role, key)}
                              className="w-4 h-4 accent-slate-900"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Action Permissions</p>
                      <div className="space-y-2">
                        {ACTION_META.map(({ key, label }) => (
                          <label key={key} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-all">
                            <span className="text-sm font-semibold text-slate-700">{label}</span>
                            <input
                              type="checkbox"
                              checked={current.actions[key]}
                              onChange={() => toggleAction(role, key)}
                              className="w-4 h-4 accent-slate-900"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Regenerate confirm */}
      <ConfirmModal
        isOpen={regenTarget !== null}
        title="Regenerate Access Code"
        message={regenTarget ? `Generate a new access code for ${ROLE_LABELS[regenTarget]}? The current code will stop working immediately for anyone who hasn't logged in yet.` : ''}
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeRegenerate}
        onCancel={() => setRegenTarget(null)}
      />

      {/* New code callout */}
      {justRegenerated && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-2xl shadow-2xl p-5 max-w-sm z-50 animate-in slide-in-from-bottom-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">New {ROLE_LABELS[justRegenerated.role]} Code</p>
            <button onClick={() => setJustRegenerated(null)} className="text-white/50 hover:text-white text-xs">Dismiss</button>
          </div>
          <p className="font-mono text-2xl font-bold tracking-[0.2em] mb-2">{justRegenerated.code}</p>
          <p className="text-xs text-white/60">Share this with everyone using this role — it's already visible above too, revealed and ready to copy.</p>
        </div>
      )}
    </div>
  );
};

export default AdminPage;

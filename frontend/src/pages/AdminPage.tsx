import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, AlertCircle, Eye, EyeOff, Copy, Check,
  KeyRound, SlidersHorizontal, Shield, Users, ClipboardList, Pencil, X,
  Radio, LogOut, Clock, ShieldOff, RotateCcw, UserCog,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { authHeaders } from '../utils/authToken';
import type { PagePermissions, ActionPermissions } from '../auth/RoleContext';
import { useRole } from '../auth/RoleContext';

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
  { key: 'shiftManagement', label: 'Shift Management' },
  { key: 'importRoster', label: 'Import Roster' },
  { key: 'manageRoles', label: 'Manage Roles & Permissions' },
  { key: 'manage2FA', label: 'Manage 2FA Settings' },
  { key: 'manageAccessCodes', label: 'Manage Access Codes' },
  { key: 'manageSessions', label: 'Manage Sessions' },
];

interface CodesState { admin: string | null; queue_handler: string | null; associate: string | null; }
type PermsMap = Record<'queue_handler' | 'associate', { pages: PagePermissions; actions: ActionPermissions } | null>;
interface SessionRecord {
  jti: string;
  fullName: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  isOnline: boolean;
  isSelf: boolean;
}
interface TwoFactorRecord {
  fullName: string;
  enabled: boolean;
  createdAt: string;
  enabledAt?: string;
  lastUsedAt?: string;
}
interface PendingUserRecord {
  fullName: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  assignedRole?: string;
  workType?: 'voice' | 'non-voice';
}

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.details ? `${data.error}: ${data.details}` : data.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

const AdminPage: React.FC = () => {
  const { actions } = useRole();
  const canManageAccessCodes = actions.manageAccessCodes;
  const canManageRoles = actions.manageRoles;
  const canManageSessions = actions.manageSessions;
  const canManage2FA = actions.manage2FA;
  const [tab, setTab] = useState<'pending' | 'codes' | 'permissions' | 'sessions' | 'twofactor' | 'users'>('pending');

  // ---- Users state (for role management) ----
  interface UserRecord {
    _id: string;
    fullName: string;
    username: string;
    role: Role;
    workType: 'voice' | 'non-voice';
    isActive: boolean;
  }
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [userRoleChanges, setUserRoleChanges] = useState<Record<string, Role>>({});
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  // ---- Access codes state ----
  const [codes, setCodes] = useState<CodesState>({ admin: null, queue_handler: null, associate: null });
  const [revealed, setRevealed] = useState<Record<Role, boolean>>({ admin: false, queue_handler: false, associate: false });
  const [copied, setCopied] = useState<Role | null>(null);
  const [regenTarget, setRegenTarget] = useState<Role | null>(null);
  const [justRegenerated, setJustRegenerated] = useState<{ role: Role; code: string } | null>(null);
  const [editingCode, setEditingCode] = useState<Role | null>(null);
  const [customCodeValue, setCustomCodeValue] = useState('');
  const [settingCode, setSettingCode] = useState<Role | null>(null);
  const [codeFieldError, setCodeFieldError] = useState<string | null>(null);

  // ---- Permissions state ----
  const [perms, setPerms] = useState<PermsMap>({ queue_handler: null, associate: null });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState<Role | null>(null);

  // ---- Sessions state ----
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [kickTarget, setKickTarget] = useState<SessionRecord | null>(null);
  const [kicking, setKicking] = useState<string | null>(null);

  // ---- 2FA oversight state ----
  const [twoFactorRecords, setTwoFactorRecords] = useState<TwoFactorRecord[]>([]);
  const [resetTarget, setResetTarget] = useState<TwoFactorRecord | null>(null);

  // ---- Pending approvals state ----
  const [pendingUsers, setPendingUsers] = useState<PendingUserRecord[]>([]);
  const [approvingUser, setApprovingUser] = useState<string | null>(null);
  const [rejectingUser, setRejectingUser] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Record<string, Role>>({});
  const [selectedWorkType, setSelectedWorkType] = useState<Record<string, 'voice' | 'non-voice'>>({});
  const [resetting, setResetting] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [codesRes, qhRes, assocRes, sessionsRes, twoFactorRes, pendingRes, usersRes] = await Promise.all([
        api('/api/access/codes'),
        api('/api/access/permissions/queue_handler'),
        api('/api/access/permissions/associate'),
        api('/api/access/sessions'),
        api('/api/access/2fa/list'),
        api('/api/access/pending'),
        api('/api/roles'),
      ]);
      setCodes(codesRes.codes);
      setPerms({
        queue_handler: { pages: qhRes.pages, actions: qhRes.actions },
        associate: { pages: assocRes.pages, actions: assocRes.actions },
      });
      setSessions(sessionsRes.sessions || []);
      setTwoFactorRecords(twoFactorRes.records || []);
      setPendingUsers(pendingRes || []);
      setUsers(usersRes.users || []);
      setUserRoleChanges({});
      setDirty({});
    } catch (err: any) {
      const isNetworkError = err instanceof TypeError || err?.message === 'Failed to fetch';
      setError(
        isNetworkError
          ? 'Could not reach the server. If the backend was recently idle, it can take up to a minute to wake up — try Refresh in a moment.'
          : (err.message || 'Failed to load admin data. Admin privileges required.')
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Check and restrict tab access based on permissions
  useEffect(() => {
    if (tab === 'codes' && !canManageAccessCodes) setTab('pending');
    if (tab === 'permissions' && !canManageRoles) setTab('pending');
    if (tab === 'sessions' && !canManageSessions) setTab('pending');
    if (tab === 'twofactor' && !canManage2FA) setTab('pending');
  }, [tab, canManageAccessCodes, canManageRoles, canManageSessions, canManage2FA]);

  // Lightweight live-ish refresh of just the sessions list while that tab is open
  useEffect(() => {
    if (tab !== 'sessions') return;
    const interval = setInterval(() => {
      api('/api/access/sessions').then((data) => setSessions(data.sessions || [])).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [tab]);

  const executeKick = async () => {
    if (!kickTarget) return;
    const { jti } = kickTarget;
    setKickTarget(null);
    setKicking(jti);
    setError(null);
    try {
      await api(`/api/access/sessions/${jti}/kick`, { method: 'POST' });
      setSessions((s) => s.filter((sess) => sess.jti !== jti));
    } catch (err: any) {
      setError(err.message || 'Failed to kick session');
    } finally {
      setKicking(null);
    }
  };

  const executeReset2FA = async () => {
    if (!resetTarget) return;
    const { fullName } = resetTarget;
    setResetTarget(null);
    setResetting(fullName);
    setError(null);
    try {
      await api('/api/access/2fa/admin-reset', { method: 'POST', body: JSON.stringify({ fullName }) });
      setTwoFactorRecords((r) => r.filter((rec) => rec.fullName !== fullName));
    } catch (err: any) {
      setError(err.message || 'Failed to reset 2FA');
    } finally {
      setResetting(null);
    }
  };

  const handleApproveUser = async (fullName: string) => {
    setApprovingUser(fullName);
    setError(null);
    try {
      const role = selectedRole[fullName] || 'associate';
      const workType = selectedWorkType[fullName] || 'voice';
      await api(`/api/access/pending/${encodeURIComponent(fullName)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ role, workType })
      });
      setPendingUsers((p) => p.filter((u) => u.fullName !== fullName));
    } catch (err: any) {
      setError(err.message || 'Failed to approve user');
    } finally {
      setApprovingUser(null);
    }
  };

  const handleRejectUser = async (fullName: string) => {
    setRejectingUser(fullName);
    setError(null);
    try {
      await api(`/api/access/pending/${encodeURIComponent(fullName)}/reject`, {
        method: 'POST'
      });
      setPendingUsers((p) => p.filter((u) => u.fullName !== fullName));
    } catch (err: any) {
      setError(err.message || 'Failed to reject user');
    } finally {
      setRejectingUser(null);
    }
  };

  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  }

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

  const startEditingCode = (role: Role) => {
    setEditingCode(role);
    setCustomCodeValue('');
    setCodeFieldError(null);
  };

  const cancelEditingCode = () => {
    setEditingCode(null);
    setCustomCodeValue('');
    setCodeFieldError(null);
  };

  const submitCustomCode = async (role: Role) => {
    const value = customCodeValue.trim();
    if (!/^\d{6}$/.test(value)) {
      setCodeFieldError('Must be exactly 6 digits');
      return;
    }
    setSettingCode(role);
    setCodeFieldError(null);
    try {
      const data = await api(`/api/access/codes/${role}/set`, {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setCodes((c) => ({ ...c, [role]: data.code }));
      setRevealed((r) => ({ ...r, [role]: true }));
      setEditingCode(null);
      setCustomCodeValue('');
    } catch (err: any) {
      setCodeFieldError(err.message || 'Failed to set code');
    } finally {
      setSettingCode(null);
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

  const handleUpdateUserRole = async (userId: string, newRole: Role, workType: 'voice' | 'non-voice') => {
    setUpdatingRole(userId);
    setError(null);
    try {
      const data = await api('/api/roles', {
        method: 'PUT',
        body: JSON.stringify({ userId, role: newRole, workType }),
      });
      setUsers((u) => u.map((usr) => usr._id === userId ? { ...usr, role: data.user.role, workType: data.user.workType } : usr));
      setUserRoleChanges((c) => { const updated = { ...c }; delete updated[userId]; return updated; });
    } catch (err: any) {
      setError(err.message || 'Failed to update user role');
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    const { _id, fullName } = deleteTarget;
    setDeleteTarget(null);
    setDeletingUser(_id);
    setError(null);
    try {
      await api(`/api/roles/${_id}`, { method: 'DELETE' });
      setUsers((u) => u.filter((usr) => usr._id !== _id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setDeletingUser(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-900 to-purple-700 rounded-lg flex items-center justify-center shadow-lg shadow-purple-900/20">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Access Control</h1>
            <p className="text-xs text-slate-500">Manage roles and permissions</p>
          </div>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded text-xs font-semibold text-red-700 shrink-0">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-3 shrink-0 overflow-x-auto">
        <button
          onClick={() => setTab('pending')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            tab === 'pending' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Clock size={16} />
          User Approvals
          {pendingUsers.length > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === 'pending' ? 'bg-amber-500' : 'bg-amber-500 text-white'}`}>
              {pendingUsers.length}
            </span>
          )}
        </button>
        <button
          onClick={() => canManageAccessCodes && setTab('codes')}
          disabled={!canManageAccessCodes}
          title={!canManageAccessCodes ? 'Permission denied' : ''}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            !canManageAccessCodes ? 'opacity-40 cursor-not-allowed' : ''
          } ${
            tab === 'codes' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <KeyRound size={14} />
          Codes
        </button>
        <button
          onClick={() => canManageRoles && setTab('permissions')}
          disabled={!canManageRoles}
          title={!canManageRoles ? 'Permission denied' : ''}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            !canManageRoles ? 'opacity-40 cursor-not-allowed' : ''
          } ${
            tab === 'permissions' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal size={14} />
          Perms
        </button>
        <button
          onClick={() => canManageSessions && setTab('sessions')}
          disabled={!canManageSessions}
          title={!canManageSessions ? 'Permission denied' : ''}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            !canManageSessions ? 'opacity-40 cursor-not-allowed' : ''
          } ${
            tab === 'sessions' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Radio size={16} />
          Active Sessions
          {sessions.length > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === 'sessions' ? 'bg-white/20' : 'bg-slate-100'}`}>
              {sessions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => canManage2FA && setTab('twofactor')}
          disabled={!canManage2FA}
          title={!canManage2FA ? 'Permission denied' : ''}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            !canManage2FA ? 'opacity-40 cursor-not-allowed' : ''
          } ${
            tab === 'twofactor' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShieldCheck size={14} />
          2FA
        </button>
        <button
          onClick={() => setTab('users')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
            tab === 'users' ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <UserCog size={14} />
          Users
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <RefreshCw size={32} className="animate-spin opacity-50" />
          </div>
        ) : tab === 'pending' ? (
          <div className="space-y-4 max-w-3xl">
            {pendingUsers.length === 0 ? (
              <div className="text-center py-24 text-slate-400">
                <Clock size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-sm font-semibold">No pending approval requests</p>
              </div>
            ) : (
              pendingUsers.map((user) => (
                <div key={user.fullName} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{user.fullName}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Requested {timeAgo(user.requestedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={selectedRole[user.fullName] || 'associate'}
                        onChange={(e) => setSelectedRole({ ...selectedRole, [user.fullName]: e.target.value as Role })}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold"
                        disabled={approvingUser === user.fullName || rejectingUser === user.fullName}
                      >
                        <option value="associate">Associate</option>
                        <option value="queue_handler">Queue Handler</option>
                        <option value="admin">Admin</option>
                      </select>
                      <select
                        value={selectedWorkType[user.fullName] || user.workType || 'voice'}
                        onChange={(e) => setSelectedWorkType({ ...selectedWorkType, [user.fullName]: e.target.value as 'voice' | 'non-voice' })}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold"
                        disabled={approvingUser === user.fullName || rejectingUser === user.fullName}
                      >
                        <option value="voice">Voice</option>
                        <option value="non-voice">Non-Voice</option>
                      </select>
                      <button
                        onClick={() => handleApproveUser(user.fullName)}
                        disabled={approvingUser === user.fullName || rejectingUser === user.fullName}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold transition-all"
                      >
                        {approvingUser === user.fullName ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                        Approve
                      </button>
                      <button
                        onClick={() => handleRejectUser(user.fullName)}
                        disabled={approvingUser === user.fullName || rejectingUser === user.fullName}
                        className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold transition-all"
                      >
                        {rejectingUser === user.fullName ? <RefreshCw size={14} className="animate-spin" /> : <X size={14} />}
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === 'codes' ? (
          <div className="space-y-4 max-w-3xl">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <ClipboardList size={18} className="shrink-0 mt-0.5" />
              <p>Each role signs in with its own 6-digit access code plus their name. Regenerating a code immediately invalidates the old one — share the new code with everyone using that role before they next log in.</p>
            </div>
            {(['admin', 'queue_handler', 'associate'] as Role[]).map((role) => (
              <div key={role} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between">
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => (editingCode === role ? cancelEditingCode() : startEditingCode(role))}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                    >
                      {editingCode === role ? <X size={14} /> : <Pencil size={14} />}
                      {editingCode === role ? 'Cancel' : 'Set Custom'}
                    </button>
                    <button
                      onClick={() => setRegenTarget(role)}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                    >
                      <RefreshCw size={14} />
                      Regenerate
                    </button>
                  </div>
                </div>

                {editingCode === role && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-3">
                    <div className="flex-1">
                      <input
                        autoFocus
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={customCodeValue}
                        onChange={(e) => { setCustomCodeValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeFieldError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitCustomCode(role); if (e.key === 'Escape') cancelEditingCode(); }}
                        placeholder="Enter new 6-digit code"
                        className="w-full max-w-xs px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm tracking-[0.2em] focus:border-slate-400 focus:bg-white outline-none transition-all"
                      />
                      {codeFieldError && <p className="text-xs font-semibold text-red-600 mt-1.5">{codeFieldError}</p>}
                    </div>
                    <button
                      onClick={() => submitCustomCode(role)}
                      disabled={settingCode === role}
                      className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    >
                      {settingCode === role ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                      Save Code
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : tab === 'permissions' ? (
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
        ) : tab === 'sessions' ? (
          <div className="space-y-4 max-w-3xl">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <Radio size={18} className="shrink-0 mt-0.5" />
              <p>Every active login session, wherever it's happening. "Online" means their app has a live connection right now; kicking a session forces an immediate logout — they'll need their access code to sign back in.</p>
            </div>
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Radio size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No active sessions</p>
              </div>
            ) : (
              sessions.map((s) => (
                <div key={s.jti} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="relative w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-500 border border-slate-100 shrink-0">
                      <Users size={20} />
                      {s.isOnline && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white" title="Online now" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-slate-900 truncate">{s.fullName}</span>
                        {s.isSelf && <span className="text-[10px] font-bold text-slate-400 uppercase">(You)</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${ROLE_COLORS[s.role]}`}>
                          {ROLE_LABELS[s.role]}
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${s.isOnline ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {s.isOnline ? 'Online' : 'Signed in, not connected'}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock size={11} /> last seen {timeAgo(s.lastSeenAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!s.isSelf && (
                    <button
                      onClick={() => setKickTarget(s)}
                      disabled={kicking === s.jti}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 transition-all shadow-sm active:scale-95 disabled:opacity-50 shrink-0"
                    >
                      {kicking === s.jti ? <RefreshCw size={14} className="animate-spin" /> : <LogOut size={14} />}
                      Kick
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        ) : tab === 'twofactor' ? (
          <div className="space-y-4 max-w-3xl">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <ShieldCheck size={18} className="shrink-0 mt-0.5" />
              <p>Two-factor is optional and self-service — anyone can enable it from Settings. Reset here only if someone loses their authenticator device; this removes their 2FA entirely so they can re-enroll.</p>
            </div>
            {twoFactorRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <ShieldOff size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No one has enabled 2FA yet</p>
              </div>
            ) : (
              twoFactorRecords.map((rec) => (
                <div key={rec.fullName} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${rec.enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                      {rec.enabled ? <ShieldCheck size={20} /> : <Clock size={20} />}
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-slate-900 truncate block">{rec.fullName}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${rec.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {rec.enabled ? `Enabled ${rec.enabledAt ? timeAgo(rec.enabledAt) : ''}` : 'Setup started, not confirmed'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setResetTarget(rec)}
                    disabled={resetting === rec.fullName}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    {resetting === rec.fullName ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    Reset
                  </button>
                </div>
              ))
            )}
          </div>
        ) : tab === 'users' ? (
          <div className="space-y-3">
            <div className="px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-start gap-3">
              <UserCog size={18} className="shrink-0 mt-0.5" />
              <p>Change role assignments or delete users. Updates take effect on their next page load.</p>
            </div>
            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Users size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No registered users yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {users.map((user) => (
                  <div key={user._id} className="bg-white rounded-lg border border-slate-200 shadow-sm p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{user.fullName}</h3>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${ROLE_COLORS[user.role]}`}>
                          {ROLE_LABELS[user.role]}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-cyan-50 text-cyan-700 border-cyan-200">
                          {user.workType || 'voice'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">@{user.username}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={userRoleChanges[user._id] ?? user.role}
                        onChange={(e) => setUserRoleChanges({ ...userRoleChanges, [user._id]: e.target.value as Role })}
                        className="px-2.5 py-1.5 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:border-slate-400"
                        disabled={updatingRole === user._id || deletingUser === user._id}
                      >
                        <option value="associate">Associate</option>
                        <option value="queue_handler">Queue Handler</option>
                        <option value="admin">Admin</option>
                      </select>
                      <select
                        value={selectedWorkType[user._id] ?? user.workType ?? 'voice'}
                        onChange={(e) => setSelectedWorkType({ ...selectedWorkType, [user._id]: e.target.value as 'voice' | 'non-voice' })}
                        className="px-2.5 py-1.5 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:border-slate-400"
                        disabled={updatingRole === user._id || deletingUser === user._id}
                      >
                        <option value="voice">Voice</option>
                        <option value="non-voice">Non-Voice</option>
                      </select>
                      <button
                        onClick={() => {
                          const newRole = userRoleChanges[user._id] ?? user.role;
                          const newWorkType = selectedWorkType[user._id] ?? user.workType ?? 'voice';
                          if (newRole !== user.role || newWorkType !== (user.workType ?? 'voice')) {
                            handleUpdateUserRole(user._id, newRole, newWorkType);
                          }
                        }}
                        disabled={updatingRole === user._id || deletingUser === user._id || ((userRoleChanges[user._id] === undefined || userRoleChanges[user._id] === user.role) && ((selectedWorkType[user._id] ?? user.workType ?? 'voice') === (user.workType ?? 'voice')))}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-40"
                      >
                        {updatingRole === user._id ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                        Save
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        disabled={updatingRole === user._id || deletingUser === user._id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded text-xs font-semibold hover:bg-red-50 transition-all active:scale-95 disabled:opacity-40"
                        title="Delete user"
                      >
                        {deletingUser === user._id ? <RefreshCw size={12} className="animate-spin" /> : <X size={12} />}
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Reset 2FA confirm */}
      <ConfirmModal
        isOpen={resetTarget !== null}
        title="Reset Two-Factor Authentication"
        message={resetTarget ? `Remove 2FA for ${resetTarget.fullName}? They'll be able to log in with just their access code again until they re-enroll.` : ''}
        confirmLabel="Reset"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeReset2FA}
        onCancel={() => setResetTarget(null)}
      />

      {/* Delete user confirm */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="Delete User"
        message={deleteTarget ? `Permanently delete ${deleteTarget.fullName}? This cannot be undone. They'll be removed from the database and all their data will be inaccessible.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Kick confirm */}
      <ConfirmModal
        isOpen={kickTarget !== null}
        title="Kick Session"
        message={kickTarget ? `End ${kickTarget.fullName}'s session (${ROLE_LABELS[kickTarget.role]})? They'll be logged out immediately and will need their access code to sign back in.` : ''}
        confirmLabel="Kick"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeKick}
        onCancel={() => setKickTarget(null)}
      />

      {/* Regenerate confirm */}
      <ConfirmModal
        isOpen={regenTarget !== null}
        title="Regenerate Access Code"
        message={regenTarget ? `Generate a new access code for ${ROLE_LABELS[regenTarget]}? The current code will stop working immediately for anyone who hasn't logged in yet.` : ''}
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        variant="danger"
        requireTypedConfirmation="REGENERATE"
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
    </div>
  );
};

export default AdminPage;

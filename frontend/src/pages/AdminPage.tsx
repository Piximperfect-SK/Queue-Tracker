import React, { useState, useEffect } from 'react';
import { ShieldCheck, Users, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

interface UserWithRole {
  _id: string;
  fullName: string;
  username: string;
  role: 'admin' | 'queue_handler' | 'associate';
  isActive: boolean;
}

interface PendingChange {
  userId: string;
  fullName: string;
  fromRole: string;
  toRole: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  queue_handler: 'Queue Handler',
  associate: 'Associate',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  queue_handler: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  associate: 'bg-slate-100 text-slate-600 border-slate-200',
};

const AdminPage: React.FC = () => {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/roles', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 403) {
          setError('Access denied. Admin privileges required.');
        } else {
          setError('Failed to fetch users');
        }
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const confirmRoleChange = (userId: string, fullName: string, fromRole: string, toRole: string) => {
    setPendingChange({ userId, fullName, fromRole, toRole });
  };

  const executeRoleChange = async () => {
    if (!pendingChange) return;
    const { userId, toRole } = pendingChange;
    setPendingChange(null);
    setUpdatingId(userId);
    setUpdateError(null);
    try {
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();
      const res = await fetch('/api/roles', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '' },
        body: JSON.stringify({ userId, role: toRole }),
      });
      if (!res.ok) {
        const errData = await res.json();
        setUpdateError(errData.error || 'Failed to update role');
        return;
      }
      await fetchUsers();
    } catch (err) {
      setUpdateError('Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-900 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-900/20">
            <ShieldCheck size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Panel</h1>
            <p className="text-sm text-slate-500">Role management & user administration</p>
          </div>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {(error || updateError) && (
        <div className="flex items-center gap-3 mb-6 px-5 py-4 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold text-red-700 shrink-0">
          <AlertCircle size={18} />
          {error || updateError}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Users size={16} />
            Registered Users
          </h2>
          <span className="text-xs font-semibold text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
            {users.length} total
          </span>
        </div>

        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <RefreshCw size={32} className="animate-spin opacity-50" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Users size={48} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No registered users</p>
            <p className="text-xs mt-1">Users who sign in via account login will appear here</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 scrollbar-hide">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 sticky top-0 z-10">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Full Name</th>
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Username</th>
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Current Role</th>
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-bold text-slate-900">{u.fullName}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{u.username}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${ROLE_COLORS[u.role] || ROLE_COLORS.associate}`}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="relative inline-block">
                        <select
                          value={u.role}
                          onChange={(e) => confirmRoleChange(u._id, u.fullName, u.role, e.target.value)}
                          disabled={updatingId === u._id}
                          className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 pr-8 cursor-pointer disabled:opacity-50"
                        >
                          <option value="admin">Admin</option>
                          <option value="queue_handler">Queue Handler</option>
                          <option value="associate">Associate</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="mt-4 shrink-0 text-center">
        <p className="text-[10px] font-semibold text-slate-400">
          Only users who have logged in via account credentials are shown here.
        </p>
      </div>

      {/* Confirm Role Change Modal */}
      <ConfirmModal
        isOpen={pendingChange !== null}
        title="Change User Role"
        message={pendingChange ? `Change ${pendingChange.fullName}'s role from "${ROLE_LABELS[pendingChange.fromRole] || pendingChange.fromRole}" to "${ROLE_LABELS[pendingChange.toRole] || pendingChange.toRole}"?` : ''}
        confirmLabel="Change Role"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={executeRoleChange}
        onCancel={() => setPendingChange(null)}
      />
    </div>
  );
};

export default AdminPage;
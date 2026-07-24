import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { socket } from '../utils/socket';
import { authHeaders } from '../utils/authToken';

export type UserRole = 'admin' | 'queue_handler' | 'associate' | null;

export interface PagePermissions {
  roster: boolean;
  stats: boolean;
  logMonitor: boolean;
  settings: boolean;
  admin: boolean;
}

export interface ActionPermissions {
  editRoster: boolean;
  editHandlers: boolean;
  deleteLog: boolean;
  exportData: boolean;
  manageUsers: boolean;
  downloadLogs: boolean;
}

interface RoleContextValue {
  role: UserRole;
  pages: PagePermissions;
  actions: ActionPermissions;
  loadingRole: boolean;
  refreshRole: () => Promise<void>;
}

const NO_PAGES: PagePermissions = { roster: false, stats: false, logMonitor: false, settings: false, admin: false };
const NO_ACTIONS: ActionPermissions = { editRoster: false, editHandlers: false, deleteLog: false, exportData: false, manageUsers: false, downloadLogs: false };

const RoleContext = createContext<RoleContextValue>({
  role: null,
  pages: NO_PAGES,
  actions: NO_ACTIONS,
  loadingRole: true,
  refreshRole: async () => {},
});

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>(null);
  const [pages, setPages] = useState<PagePermissions>(NO_PAGES);
  const [actions, setActions] = useState<ActionPermissions>(NO_ACTIONS);
  const [loadingRole, setLoadingRole] = useState(true);

  // Permissions are always fetched fresh from the server on every refresh —
  // deliberately NOT cached in localStorage, so a role/permission change made
  // by Admin (or a revoked session) takes effect on next check rather than
  // trusting stale client-side state.
  const refreshRole = useCallback(async () => {
    setLoadingRole(true);
    try {
      const res = await fetch(`${BACKEND}/api/access/permissions`, {
        credentials: 'include',
        headers: { ...authHeaders() },
      });
      if (res.ok) {
        const data = await res.json();
        setRole(data.role ?? null);
        setPages(data.pages ?? NO_PAGES);
        setActions(data.actions ?? NO_ACTIONS);
        setLoadingRole(false);
        return;
      }
    } catch (_) { /* backend unreachable */ }

    // Not logged in, session expired, or backend unreachable — no access.
    setRole(null);
    setPages(NO_PAGES);
    setActions(NO_ACTIONS);
    setLoadingRole(false);
  }, []);

  // Re-run whenever the socket (re)authenticates
  useEffect(() => {
    const onInit = () => setTimeout(refreshRole, 150);
    socket.on('init', onInit);
    socket.on('connect', onInit);
    return () => { socket.off('init', onInit); socket.off('connect', onInit); };
  }, [refreshRole]);

  useEffect(() => { refreshRole(); }, [refreshRole]);

  return (
    <RoleContext.Provider value={{ role, pages, actions, loadingRole, refreshRole }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRole = () => useContext(RoleContext);

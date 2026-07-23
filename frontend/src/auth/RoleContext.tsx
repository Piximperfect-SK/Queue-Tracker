import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { socket } from '../utils/socket';

export type UserRole = 'admin' | 'queue_handler' | 'associate' | null;

interface RoleContextValue {
  role: UserRole;
  loadingRole: boolean;
  refreshRole: () => Promise<void>;
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  loadingRole: true,
  refreshRole: async () => {},
});

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem('userRole');
    return (saved && ['admin','queue_handler','associate'].includes(saved))
      ? saved as UserRole : null;
  });
  const [loadingRole, setLoadingRole] = useState(true);

  const refreshRole = useCallback(async () => {
    setLoadingRole(true);

    // Strategy 1: JWT account login → /api/me
    try {
      const res = await fetch(`${BACKEND}/api/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user?.role) {
          setRole(data.user.role);
          localStorage.setItem('userRole', data.user.role);
          setLoadingRole(false);
          return;
        }
      }
    } catch (_) { /* backend unreachable */ }

    // Strategy 2: Socket/name-based login → look up by full name
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser && currentUser !== 'Guest') {
      try {
        const res = await fetch(
          `${BACKEND}/api/get-role-by-name?name=${encodeURIComponent(currentUser)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.role) {
            setRole(data.role);
            localStorage.setItem('userRole', data.role);
            setLoadingRole(false);
            return;
          }
        }
      } catch (_) { /* ignore */ }
    }

    // Fallback: localStorage cache
    const saved = localStorage.getItem('userRole');
    if (saved && ['admin','queue_handler','associate'].includes(saved)) {
      setRole(saved as UserRole);
    } else {
      // Default new/unknown users to associate
      setRole('associate');
      localStorage.setItem('userRole', 'associate');
    }
    setLoadingRole(false);
  }, []);

  // Re-run on socket auth events
  useEffect(() => {
    const onInit = () => setTimeout(refreshRole, 150);
    socket.on('init', onInit);
    socket.on('connect', onInit);
    return () => { socket.off('init', onInit); socket.off('connect', onInit); };
  }, [refreshRole]);

  useEffect(() => { refreshRole(); }, [refreshRole]);

  return (
    <RoleContext.Provider value={{ role, loadingRole, refreshRole }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRole = () => useContext(RoleContext);

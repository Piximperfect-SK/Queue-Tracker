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

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const refreshRole = useCallback(async () => {
    setLoadingRole(true);

    // Strategy 1: Try JWT auth (account login)
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user && data.user.role) {
          setRole(data.user.role);
          localStorage.setItem('userRole', data.user.role);
          setLoadingRole(false);
          return;
        }
      }
    } catch (err) {
      // ignore
    }

    // Strategy 2: Look up by fullName from localStorage currentUser (socket auth)
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser && currentUser !== 'Guest') {
      try {
        const res = await fetch(`/api/get-role-by-name?name=${encodeURIComponent(currentUser)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.role) {
            setRole(data.role);
            localStorage.setItem('userRole', data.role);
            setLoadingRole(false);
            return;
          }
        }
      } catch (err) {
        // ignore
      }
    }

    // Fallback: localStorage
    const saved = localStorage.getItem('userRole');
    if (saved && ['admin', 'queue_handler', 'associate'].includes(saved)) {
      setRole(saved as UserRole);
    } else {
      setRole(null);
    }
    setLoadingRole(false);
  }, []);

  // Refresh role on socket connect/init (fires after socket-based login)
  useEffect(() => {
    const handleEvent = () => {
      // Small delay to let localStorage get set in handleInit
      setTimeout(refreshRole, 100);
    };
    socket.on('connect', handleEvent);
    socket.on('init', handleEvent);
    return () => {
      socket.off('connect', handleEvent);
      socket.off('init', handleEvent);
    };
  }, [refreshRole]);

  useEffect(() => {
    refreshRole();
  }, [refreshRole]);

  return (
    <RoleContext.Provider value={{ role, loadingRole, refreshRole }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRole = () => useContext(RoleContext);
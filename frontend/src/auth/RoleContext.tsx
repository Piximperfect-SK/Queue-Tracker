import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

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
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user && data.user.role) {
          setRole(data.user.role);
          localStorage.setItem('userRole', data.user.role);
        } else {
          setRole(null);
          localStorage.removeItem('userRole');
        }
      } else {
        // Try to restore from localStorage fallback
        const saved = localStorage.getItem('userRole');
        if (saved && ['admin', 'queue_handler', 'associate'].includes(saved)) {
          setRole(saved as UserRole);
        } else {
          setRole(null);
        }
      }
    } catch (err) {
      // Fallback to localStorage
      const saved = localStorage.getItem('userRole');
      if (saved && ['admin', 'queue_handler', 'associate'].includes(saved)) {
        setRole(saved as UserRole);
      } else {
        setRole(null);
      }
    }
    setLoadingRole(false);
  }, []);

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
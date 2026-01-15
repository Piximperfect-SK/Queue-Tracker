import React, { createContext, useContext, useState, useEffect } from 'react';

type User = { username: string; fullName: string; role: string } | null;

const AuthContext = createContext<any>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || ''}/api/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setLoading(false);
        return;
      }
    } catch (err) {
      // ignore
    }
    setUser(null);
    setLoading(false);
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || ''}/api/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Login failed');
    const data = await res.json();
    setUser(data.user);
    return data.user;
  };

  const register = async (fullName: string, username: string, password: string, registrationSecret: string) => {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || ''}/api/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, username, password, registrationSecret })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Register failed');
    const data = await res.json();
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_BACKEND_URL || ''}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {
      // ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

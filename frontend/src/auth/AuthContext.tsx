import React, { createContext, useContext, useState, useEffect } from 'react';

type User = { username: string; fullName: string; role: string } | null;

const AuthContext = createContext<any>(null);

// Centralised backend URL — never falls back to relative paths on the deployed frontend
const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = async () => {
    try {
      const res = await fetch(`${BACKEND}/api/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
        setLoading(false);
        return;
      }
    } catch (_) {
      // network error or backend down — not a crash
    }
    setUser(null);
    setLoading(false);
  };

  useEffect(() => { fetchMe(); }, []);

  const getCsrf = async (): Promise<string | null> => {
    try {
      const r = await fetch(`${BACKEND}/api/csrf-token`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (r.ok) {
        const j = await r.json();
        return j.csrfToken ?? null;
      }
    } catch (_) { /* backend unreachable */ }
    return null;
  };

  const login = async (username: string, password: string) => {
    const csrf = await getCsrf();
    if (!csrf) throw new Error('Could not fetch CSRF token. Check VITE_BACKEND_URL is set correctly.');

    const res = await fetch(`${BACKEND}/api/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      let msg = 'Login failed';
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();
    setUser(data.user);
    return data.user;
  };

  const register = async (
    fullName: string,
    username: string,
    password: string,
    registrationSecret: string
  ) => {
    const csrf = await getCsrf();
    if (!csrf) throw new Error('Could not fetch CSRF token.');

    const res = await fetch(`${BACKEND}/api/register`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ fullName, username, password, registrationSecret }),
    });

    if (!res.ok) {
      let msg = 'Registration failed';
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch(`${BACKEND}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (_) { /* ignore */ }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

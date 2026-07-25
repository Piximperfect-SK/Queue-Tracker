import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import RosterPage from './pages/RosterPage';
import TrackerPage from './pages/TrackerPage';
import SettingsPage from './pages/SettingsPage';
import LogMonitorPage from './pages/LogMonitorPage';
import { User, LogIn, ShieldAlert, ShieldCheck, Lock, Fingerprint, Loader2 } from 'lucide-react';
import { syncData, socket } from './utils/socket';
import signinBg from './assets/Background.mp4';
import bgImage from './assets/background.jpg';
import { addLog } from './utils/logger';
import { setToken, clearToken, authHeaders } from './utils/authToken';
import { RoleProvider, useRole } from './auth/RoleContext';
import AdminPage from './pages/AdminPage';
import PageGuard from './components/PageGuard';

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    const saved = localStorage.getItem('currentUser');
    return saved === 'Guest' ? null : saved;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tempName, setTempName] = useState('');
  const [tempCode, setTempCode] = useState('');
  const [pending2FA, setPending2FA] = useState<{ pendingToken: string; fullName: string; role: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isBackendDown, setIsBackendDown] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toLocaleDateString('en-CA'));

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    clearToken();
    (async () => {
      try {
        await fetch(`${BACKEND}/api/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...authHeaders() },
        });
      } catch (_) { /* best-effort — cookie/token will also just expire naturally */ }
    })();
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  // Note: initial 'Guest' cleanup is handled in the lazy initializer above
  // to avoid calling setState synchronously inside an effect.

  useEffect(() => {
    const handleConnect = () => {
      console.log('CONNECTED to server');
      setIsBackendDown(false);
      if (currentUser && currentUser !== 'Guest') {
        syncData.join(currentUser);
      }
    };

    const handleConnectError = (error: any) => {
      console.error('CONNECTION ERROR:', error);
      if (!isAuthenticated) {
        setIsBackendDown(true);
      }
      setIsVerifying(false);
    };

    const handleErrorMessage = (msg: string) => {
      setAuthError(msg);
      setIsVerifying(false);
      // Any rejection from 'join' means the session isn't valid — force
      // back to the login screen rather than leaving a half-authenticated state.
      handleLogout();
    };

    const handleInit = () => {
      // SECURITY: If for some reason the name is missing or set to "Guest", force logout
      if (!currentUser || currentUser === 'Guest') {
        handleLogout();
        return;
      }
      setIsAuthenticated(true);
      setIsVerifying(false);
      localStorage.setItem('currentUser', currentUser);
    };

    const handleKicked = (data: { message?: string }) => {
      setAuthError(data?.message || 'Your session was ended by an administrator. Please log in again.');
      handleLogout();
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('error_message', handleErrorMessage);
    socket.on('init', handleInit);
    socket.on('kicked', handleKicked);
    socket.on('presence_updated', (users: string[]) => {
      setOnlineUsers(users);
    });

    if (socket.connected) {
      handleConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('error_message', handleErrorMessage);
      socket.off('kicked', handleKicked);
      socket.off('init', handleInit);
      socket.off('presence_updated');
    };
  }, [currentUser, isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = tempName.trim();
    const cleanCode = tempCode.trim();

    if (cleanName === 'Guest') {
      setAuthError('The name "Guest" is reserved. Please use your professional name.');
      return;
    }
    if (!cleanName || !/^\d{6}$/.test(cleanCode)) {
      setAuthError('Enter your full name and the 6-digit access code.');
      return;
    }

    setIsVerifying(true);
    setAuthError(null);

    try {
      const res = await fetch(`${BACKEND}/api/access/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: cleanName, code: cleanCode }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Distinguish "server/network problem" from "wrong code" so this
        // doesn't send people hunting for a typo that isn't there.
        setAuthError(data.error || `Login failed (server returned ${res.status}). Please try again.`);
        setIsVerifying(false);
        return;
      }

      if (data.requiresTwoFactor) {
        setPending2FA({ pendingToken: data.pendingToken, fullName: data.fullName, role: data.role });
        setIsVerifying(false);
        return;
      }

      // JWT is stored as a bearer token (not just relying on the cookie —
      // cross-origin third-party cookies get silently blocked by many
      // browsers regardless of SameSite/Secure settings). The socket auth
      // function (see utils/socket.ts) reads this fresh on every connect.
      if (data.token) {
        setToken(data.token);
      }

      // The socket may already be connected from BEFORE login (it connects
      // on page load), and socket.io only reads its `auth` payload at
      // handshake time — so force a fresh connection now that the token exists.
      setCurrentUser(cleanName);
      if (socket.connected) {
        socket.disconnect();
      }
      socket.connect();
    } catch (err) {
      setAuthError('Unable to reach server. Please try again.');
      setIsVerifying(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending2FA) return;
    const cleanCode = totpCode.trim();
    if (!cleanCode) {
      setAuthError('Enter the code from your authenticator app.');
      return;
    }
    setIsVerifying(true);
    setAuthError(null);
    try {
      const res = await fetch(`${BACKEND}/api/access/login/verify-2fa`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken: pending2FA.pendingToken, code: cleanCode }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAuthError(data.error || `Verification failed (server returned ${res.status}).`);
        setIsVerifying(false);
        return;
      }

      if (data.token) setToken(data.token);
      const name = pending2FA.fullName;
      setPending2FA(null);
      setTotpCode('');
      setCurrentUser(name);
      if (socket.connected) {
        socket.disconnect();
      }
      socket.connect();
    } catch (err) {
      setAuthError('Unable to reach server. Please try again.');
      setIsVerifying(false);
    }
  };

  // 1. Backend Down State
  if (isBackendDown) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <img src={bgImage} alt="Background" className="absolute inset-0 w-full h-full object-cover scale-105" />
        
        <div className="w-full max-w-105 relative z-10">
          <div className="bg-white/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/30 shadow-2xl overflow-hidden p-10 text-center animate-in fade-in zoom-in duration-500">
            <div className="w-16 h-16 bg-red-500/10 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/20 shadow-sm">
              <ShieldAlert size={32} />
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">System Offline</h1>
            <p className="text-slate-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-10 leading-relaxed">
              Establishing Secure Link... <br/>
              <span className="opacity-60 text-[10px]">Server may be waking from sleep</span>
            </p>
            <div className="space-y-4">
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95"
              >
                Manual Retry
              </button>
              <div className="flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span>Auto-Reconnecting...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Auth State

  if (!isAuthenticated) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden font-sans">
          {/* Background Video for Auth Screen */}
          <video 
            autoPlay 
            muted 
            loop 
            playsInline
            className="absolute inset-0 w-full h-full object-cover scale-105"
          >
            <source src={signinBg} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px]" />
          
          <div className="w-full max-w-105 relative z-10">
            <div className="bg-white/80 backdrop-blur-3xl rounded-[2.5rem] border border-white/50 shadow-2xl overflow-hidden p-10 animate-in fade-in zoom-in duration-500">
              <div className="text-center mb-10">
                <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-slate-900/40">
                  {pending2FA ? <ShieldCheck size={28} className="text-white" /> : <Fingerprint size={28} className="text-white" />}
                </div>
                <h1 className="text-2xl font-black text-slate-950 mb-1 tracking-tight">{pending2FA ? 'Verify Identity' : 'Access Gate'}</h1>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">
                  {pending2FA ? `Enter the code from your authenticator app` : 'Authorized Handlers Only'}
                </p>
              </div>

              {pending2FA ? (
                <form onSubmit={handleVerify2FA} className="space-y-6">
                  {authError && (
                    <div className="p-4 bg-rose-600/10 border border-rose-500/30 rounded-2xl text-rose-700 text-[10px] font-black uppercase tracking-widest text-center animate-pulse">
                      {authError}
                    </div>
                  )}
                  <div className="group">
                    <div className="flex items-center gap-2 mb-2 ml-1">
                      <ShieldCheck size={12} className="text-slate-500 group-focus-within:text-blue-600 transition-colors" />
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-600 transition-colors">Authenticator Code</label>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 8))}
                      placeholder="6-digit code or backup code"
                      disabled={isVerifying}
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:border-blue-600 focus:bg-white outline-none text-slate-950 font-black tracking-[0.3em] transition-all placeholder:text-slate-400 placeholder:tracking-normal placeholder:text-xs"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isVerifying}
                    className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-3"
                  >
                    {isVerifying ? <Loader2 size={18} className="animate-spin" /> : <><LogIn size={18} /><span>Verify & Continue</span></>}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPending2FA(null); setTotpCode(''); setAuthError(null); }}
                    className="w-full text-center text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Back to login
                  </button>
                </form>
              ) : (
              <form onSubmit={handleLogin} className="space-y-6">
                {authError && (
                  <div className="p-4 bg-rose-600/10 border border-rose-500/30 rounded-2xl text-rose-700 text-[10px] font-black uppercase tracking-widest text-center animate-pulse">
                    {authError}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="group">
                    <div className="flex items-center gap-2 mb-2 ml-1">
                      <User size={12} className="text-slate-500 group-focus-within:text-blue-600 transition-colors" />
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-600 transition-colors">Identification</label>
                    </div>
                    <input 
                      autoFocus
                      type="text" 
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      placeholder="Enter your full name"
                      disabled={isVerifying}
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:border-blue-600 focus:bg-white outline-none text-slate-950 font-black transition-all placeholder:text-slate-400"
                      required
                    />
                  </div>

                  <div className="group">
                    <div className="flex items-center gap-2 mb-2 ml-1">
                      <Lock size={12} className="text-slate-500 group-focus-within:text-blue-600 transition-colors" />
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-600 transition-colors">Access Code</label>
                    </div>
                    <input 
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={tempCode}
                      onChange={(e) => setTempCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      disabled={isVerifying}
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:border-blue-600 focus:bg-white outline-none text-slate-950 font-black tracking-[0.3em] transition-all placeholder:text-slate-400 placeholder:tracking-normal"
                      required
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isVerifying}
                  className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-3"
                >
                  {isVerifying ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <LogIn size={18} />
                      <span>Establish Link</span>
                    </>
                  )}
                </button>
              </form>
              )}

              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-full border border-slate-200">
                  <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Secure Link Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
    );
  }

  // 3. Main App State
  return (
    <Router>
      <NavigationLogger />
      <AppFrame
        currentUser={currentUser!}
        onLogout={handleLogout}
        onlineUsers={onlineUsers}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        bgImage={bgImage}
      />
    </Router>
  );
}


export default App;

const NavigationLogger: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const pathWithSearch = `${location.pathname}${location.search || ''}`;
    addLog('Navigate', `Visited ${pathWithSearch}`);
  }, [location.pathname, location.search]);

  return null;
};

const AppFrame: React.FC<{
  currentUser: string;
  onLogout: () => void;
  onlineUsers: string[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  bgImage: string;
}> = ({ currentUser, onLogout, onlineUsers, selectedDate, setSelectedDate, bgImage }) => {
  const location = useLocation();
  const isTracker = location.pathname === '/tracker';

  return (
    <RoleProvider>
    <div className="h-screen w-full relative overflow-hidden font-sans selection:bg-blue-500/30 text-slate-900">
      {/* Background Image */}
      <img src={bgImage} alt="Background" className="absolute inset-0 w-full h-full object-cover scale-105" />

      {/* Background visible — overlay removed to expose wallpaper */}

      <div className="relative z-10 flex flex-col h-full">
        <Navbar currentUser={currentUser} onLogout={onLogout} onlineUsers={onlineUsers} />
        <main className={`flex-1 w-full max-w-full mx-auto overflow-hidden ${isTracker ? 'px-0 py-0' : 'px-3 py-2'}`}>
          <Routes>
            <Route path="/" element={<PageGuard page="roster"><RosterPage selectedDate={selectedDate} setSelectedDate={setSelectedDate} /></PageGuard>} />
            <Route path="/tracker" element={<PageGuard page="stats"><TrackerPage selectedDate={selectedDate} setSelectedDate={setSelectedDate} /></PageGuard>} />
            <Route path="/settings" element={<PageGuard page="settings"><SettingsPage /></PageGuard>} />
            <Route path="/logs" element={<PageGuard page="logMonitor"><LogMonitorPage /></PageGuard>} />
            <Route path="/admin" element={<PageGuard page="admin"><AdminPage /></PageGuard>} />
          </Routes>
        </main>
      </div>
    </div>
    </RoleProvider>
  );
};

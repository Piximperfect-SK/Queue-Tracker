import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import RosterPage from './pages/RosterPage';
import TrackerPage from './pages/TrackerPage';
import SettingsPage from './pages/SettingsPage';
import LogMonitorPage from './pages/LogMonitorPage';
import { User, LogIn, ShieldAlert, Lock, Fingerprint, Loader2 } from 'lucide-react';
import { syncData, socket } from './utils/socket';
import bgVideo from './assets/video-background.mp4';

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(localStorage.getItem('currentUser'));
  const [accessKey, setAccessKey] = useState<string>(localStorage.getItem('teamAccessKey') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tempName, setTempName] = useState('');
  const [tempKey, setTempKey] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isBackendDown, setIsBackendDown] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('teamAccessKey');
    setCurrentUser(null);
    setAccessKey('');
    setIsAuthenticated(false);
  };

  useEffect(() => {
    // PREVENT "Guest" from sticking around in localStorage from old versions
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser === 'Guest') {
      handleLogout();
    }
  }, []);

  useEffect(() => {
    const handleConnect = () => {
      console.log('CONNECTED to server');
      setIsBackendDown(false);
      if (currentUser && currentUser !== 'Guest') {
        syncData.join(currentUser, accessKey);
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
      if (msg.toLowerCase().includes('denied')) {
        handleLogout();
      }
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
      localStorage.setItem('teamAccessKey', accessKey);
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('error_message', handleErrorMessage);
    socket.on('init', handleInit);
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
      socket.off('init', handleInit);
      socket.off('presence_updated');
    };
  }, [currentUser, accessKey, isAuthenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = tempName.trim();
    if (cleanName && cleanName !== 'Guest') {
      setIsVerifying(true);
      setAuthError(null);
      setCurrentUser(cleanName);
      setAccessKey(tempKey.trim());
    } else if (cleanName === 'Guest') {
      setAuthError('The name "Guest" is reserved. Please use your professional name.');
    }
  };

  // 1. Backend Down State
  if (isBackendDown) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover scale-105">
          <source src={bgVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px]" />
        
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
          <source src={bgVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-teal-50/20 backdrop-blur-[2px]" />
        
        <div className="w-full max-w-105 relative z-10">
          <div className="bg-teal-50/80 backdrop-blur-3xl rounded-[2.5rem] border border-teal-200/50 shadow-2xl overflow-hidden p-10 animate-in fade-in zoom-in duration-500">
            <div className="text-center mb-10">
              <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-600/40">
                <Fingerprint size={28} className="text-white" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">Access Gate</h1>
              <p className="text-slate-600 text-[10px] font-black uppercase tracking-widest">Authorized Personnel Only</p>
            </div>

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
                    className="w-full px-5 py-4 bg-teal-50/50 border border-teal-200/40 rounded-2xl focus:border-blue-500 focus:bg-teal-50/100 outline-none text-slate-900 font-black transition-all placeholder:text-slate-400"
                    required
                  />
                </div>

                <div className="group">
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <Lock size={12} className="text-slate-500 group-focus-within:text-blue-600 transition-colors" />
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-600 transition-colors">Security Key</label>
                  </div>
                  <input 
                    type="password" 
                    value={tempKey}
                    onChange={(e) => setTempKey(e.target.value)}
                    placeholder="••••••••••••"
                    disabled={isVerifying}
                    className="w-full px-5 py-4 bg-teal-50/50 border border-teal-200/40 rounded-2xl focus:border-blue-500 focus:bg-teal-50/100 outline-none text-slate-900 font-black transition-all placeholder:text-slate-400"
                    required
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={isVerifying}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-blue-600/30 active:scale-[0.98] flex items-center justify-center gap-3"
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

            <div className="mt-8 text-center">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-900/5 rounded-full border border-slate-900/10">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
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
      <div className="h-screen w-full relative overflow-hidden font-sans selection:bg-blue-500/30 text-slate-800">
        {/* Background Video */}
        <video 
          autoPlay 
          muted 
          loop 
          playsInline
          className="absolute inset-0 w-full h-full object-cover scale-105"
        >
          <source src={bgVideo} type="video/mp4" />
        </video>
        
        {/* Teal Overlay for Glassmorphism */}
        <div className="absolute inset-0 bg-teal-50/40 backdrop-blur-[2px]" />

        <div className="relative z-10 flex flex-col h-full">
          <Navbar currentUser={currentUser!} onLogout={handleLogout} onlineUsers={onlineUsers} />
          <main className="flex-1 w-full max-w-full mx-auto px-3 py-2 overflow-hidden">
            <Routes>
              <Route path="/" element={<RosterPage />} />
              <Route path="/tracker" element={<TrackerPage currentUser={currentUser!} />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/logs" element={<LogMonitorPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}


export default App;

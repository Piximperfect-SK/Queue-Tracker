import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import RosterPage from './pages/RosterPage';
import TrackerPage from './pages/TrackerPage';
import SettingsPage from './pages/SettingsPage';
import { User, LogIn, ShieldAlert, Lock, Fingerprint, Loader2 } from 'lucide-react';
import { syncData, socket } from './utils/socket';

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

  useEffect(() => {
    const handleConnect = () => {
      console.log('CONNECTED to server:', socket.io.uri);
      setIsBackendDown(false);
      if (currentUser) {
        syncData.join(currentUser, accessKey);
      }
    };

    const handleConnectError = (error: any) => {
      console.error('CONNECTION ERROR to:', socket.io.uri, error);
      setIsBackendDown(true);
      setIsVerifying(false);
    };

    const handleErrorMessage = (msg: string) => {
      setAuthError(msg);
      setIsVerifying(false);
      // If server rejects access key, clear it
      if (msg.includes('Access Denied')) {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('teamAccessKey');
        setCurrentUser(null);
        setAccessKey('');
        setIsAuthenticated(false);
      }
    };

    const handleInit = () => {
      setIsAuthenticated(true);
      setIsVerifying(false);
      // Only store in localStorage once server confirms valid session
      if (currentUser) {
        localStorage.setItem('currentUser', currentUser);
        localStorage.setItem('teamAccessKey', accessKey);
      }
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
  }, [currentUser, accessKey]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      setIsVerifying(true);
      setAuthError(null);
      setCurrentUser(tempName.trim());
      setAccessKey(tempKey.trim());
      // Handled by useEffect which triggers syncData.join
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('teamAccessKey');
    setCurrentUser(null);
    setAccessKey('');
    setIsAuthenticated(false);
  };

  if (isBackendDown) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-10 text-center border border-slate-100">
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldAlert size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 mb-3 tracking-tight">System Offline</h1>
          <p className="text-slate-500 font-medium mb-8 leading-relaxed text-sm">
            The service is currently down or waking up (Render free tier). Connection will be restored automatically.
          </p>
          <div className="space-y-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
            >
              Reload Application
            </button>
            <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 py-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span>Auto-retrying...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-screen w-screen bg-[#020617] flex items-center justify-center p-6 relative overflow-hidden font-sans">
        {/* Animated Background Orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] animate-pulse delay-700" />
        
        <div className="w-full max-w-[420px] relative">
          {/* Glass Card */}
          <div className="bg-white/[0.03] backdrop-blur-2xl rounded-[2.5rem] border border-white/[0.08] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] overflow-hidden p-10 animate-in fade-in zoom-in duration-700">
            
            {/* Header */}
            <div className="text-center mb-10">
              <div className="w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-600/20 rotate-3">
                <Fingerprint size={32} className="text-white" />
              </div>
              <h1 className="text-3xl font-black text-white mb-2 tracking-tight">Access Gate</h1>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em]">Authorized Personnel Only</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              {authError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-[10px] font-black uppercase tracking-widest text-center animate-pulse">
                  {authError}
                </div>
              )}

              <div className="space-y-4">
                <div className="group">
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <User size={12} className="text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-400 transition-colors">Identification</label>
                  </div>
                  <input 
                    autoFocus
                    type="text" 
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    placeholder="Enter your full name"
                    disabled={isVerifying}
                    className="w-full px-5 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl focus:border-blue-500/50 focus:bg-white/[0.06] outline-none text-white font-bold transition-all placeholder:text-slate-600"
                    required
                  />
                </div>

                <div className="group">
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <Lock size={12} className="text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-400 transition-colors">Security Key</label>
                  </div>
                  <input 
                    type="password" 
                    value={tempKey}
                    onChange={(e) => setTempKey(e.target.value)}
                    placeholder="••••••••••••"
                    disabled={isVerifying}
                    className="w-full px-5 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl focus:border-blue-500/50 focus:bg-white/[0.06] outline-none text-white font-bold transition-all placeholder:text-slate-600"
                    required
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={isVerifying}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98] flex items-center justify-center gap-3 group"
              >
                {isVerifying ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <LogIn size={18} className="group-hover:translate-x-1 transition-transform" />
                    <span>Establish Link</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/[0.03] rounded-full border border-white/[0.05]">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Protocol Secure</span>
              </div>
            </div>
          </div>
          
          <div className="mt-8 text-center text-slate-600 text-[10px] font-bold uppercase tracking-[0.3em]">
            &copy; 2026 Queue Tracker System
          </div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="h-screen w-screen bg-slate-50 flex flex-col overflow-hidden fixed inset-0">
        <Navbar currentUser={currentUser} onLogout={handleLogout} onlineUsers={onlineUsers} />
        <main className="flex-1 w-full overflow-hidden min-h-0 relative">
          <div className="absolute inset-0 overflow-hidden flex flex-col">
            <Routes>
              <Route path="/" element={<RosterPage />} />
              <Route path="/tracker" element={<TrackerPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;

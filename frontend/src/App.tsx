import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import RosterPage from './pages/RosterPage';
import TrackerPage from './pages/TrackerPage';
import SettingsPage from './pages/SettingsPage';
import { User, LogIn, ShieldAlert } from 'lucide-react';
import { syncData, socket } from './utils/socket';

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(localStorage.getItem('currentUser'));
  const [accessKey, setAccessKey] = useState<string>(localStorage.getItem('teamAccessKey') || '');
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
    };

    const handleErrorMessage = (msg: string) => {
      setAuthError(msg);
      // If server rejects access key, clear it
      if (msg.includes('Access Denied')) {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('teamAccessKey');
        setCurrentUser(null);
        setAccessKey('');
      }
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('error_message', handleErrorMessage);
    socket.on('presence_updated', (users: string[]) => {
      console.log('Presence update received:', users);
      setOnlineUsers(users);
    });

    if (socket.connected) {
      handleConnect();
    } else {
      socket.connect(); // Ensure it tries to connect
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('error_message', handleErrorMessage);
      socket.off('presence_updated');
    };
  }, [currentUser, accessKey]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      localStorage.setItem('currentUser', tempName.trim());
      localStorage.setItem('teamAccessKey', tempKey.trim());
      setCurrentUser(tempName.trim());
      setAccessKey(tempKey.trim());
      setAuthError(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('teamAccessKey');
    setCurrentUser(null);
    setAccessKey('');
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

  if (!currentUser) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="p-8 text-center bg-blue-600 text-white">
            <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <User size={40} />
            </div>
            <h1 className="text-2xl font-black tracking-tight mb-2">Queue Tracker</h1>
            <p className="text-blue-100 text-sm font-medium">Authorized Personnel Only</p>
          </div>
          <form onSubmit={handleLogin} className="p-8">
            {authError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-xl text-center">
                {authError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Your Full Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-4 py-4 rounded-xl border-2 border-gray-100 focus:border-blue-500 focus:ring-0 outline-none font-bold text-gray-800 transition-all placeholder:text-gray-300"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Team Access Key</label>
                <input 
                  type="password" 
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-4 rounded-xl border-2 border-gray-100 focus:border-blue-500 focus:ring-0 outline-none font-bold text-gray-800 transition-all placeholder:text-gray-300"
                  required
                />
              </div>
            </div>
            <button 
              type="submit"
              className="w-full mt-6 bg-blue-600 text-white py-4 rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <LogIn size={18} />
              <span>Verify & Start</span>
            </button>
          </form>
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

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import RosterPage from './pages/RosterPage';
import TrackerPage from './pages/TrackerPage';
import SettingsPage from './pages/SettingsPage';
import { User, LogIn } from 'lucide-react';
import { syncData, socket } from './utils/socket';

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(localStorage.getItem('currentUser'));
  const [tempName, setTempName] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    const handleConnect = () => {
      console.log('Connected to server as:', currentUser);
      if (currentUser) {
        syncData.join(currentUser);
      }
    };

    const handlePresence = (users: string[]) => {
      console.log('Presence update received:', users);
      setOnlineUsers(users);
    };

    socket.on('connect', handleConnect);
    socket.on('presence_updated', handlePresence);

    // If already connected when effect runs
    if (socket.connected) {
      handleConnect();
      // Ask server for current list if we missed the connection packet
      socket.emit('get_presence');
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('presence_updated', handlePresence);
    };
  }, [currentUser]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      localStorage.setItem('currentUser', tempName.trim());
      setCurrentUser(tempName.trim());
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
  };

  if (!currentUser) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="p-8 text-center bg-blue-600 text-white">
            <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <User size={40} />
            </div>
            <h1 className="text-2xl font-black tracking-tight mb-2">Queue Tracker</h1>
            <p className="text-blue-100 text-sm font-medium">Please enter your name to continue</p>
          </div>
          <form onSubmit={handleLogin} className="p-8">
            <div className="mb-6">
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
            <button 
              type="submit"
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <LogIn size={18} />
              <span>Start Tracking</span>
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

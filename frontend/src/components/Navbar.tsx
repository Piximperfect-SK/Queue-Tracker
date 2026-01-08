import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, BarChart2, Settings, LogOut, Activity } from 'lucide-react';
import { socket } from '../utils/socket';

interface NavbarProps {
  currentUser: string;
  onLogout: () => void;
  onlineUsers: string[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onlineUsers, selectedDate, setSelectedDate }) => {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <nav className="bg-white/60 backdrop-blur-3xl border-b border-white/20 shrink-0 sticky top-0 z-50 shadow-md">
      <div className="max-w-screen-2xl mx-auto px-6">
        <div className="flex justify-between h-14 items-center">
          <div className="flex items-center space-x-4">
            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg">Q</div>
            <span className="text-lg font-bold text-slate-900 tracking-tight">QueueTracker</span>
            
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ml-2 border transition-colors ${isConnected ? 'bg-green-500/10 text-green-700 border-green-500/30' : 'bg-red-500/10 text-red-700 border-red-500/30'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-600 animate-pulse' : 'bg-red-600'}`} />
              {isConnected ? 'Sync Active' : 'Offline'}
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Online Users Indicator - Hyper Compact */}
            <div className="flex items-center gap-2 px-2 py-0.5 bg-slate-900/5 rounded-full border border-slate-900/10 mr-2">
              <div className="flex -space-x-1.5">
                {[...new Set(onlineUsers.filter(u => u !== currentUser))].map((user, i) => (
                  <div 
                    key={i} 
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black text-white bg-slate-900 border border-white/20 shadow-sm"
                    title={user}
                  >
                    {user.charAt(0).toUpperCase()}
                  </div>
                ))}
                {onlineUsers.length <= 1 && (
                  <div className="w-4 h-4 rounded-full border border-dashed border-slate-400 flex items-center justify-center bg-transparent">
                    <div className="w-0.5 h-0.5 bg-slate-400 rounded-full" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 pr-0.5">
                <div className={`w-1 h-1 rounded-full ${onlineUsers.length > 1 ? 'bg-green-600 animate-pulse' : 'bg-slate-400'}`} />
                <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest leading-none">
                  {onlineUsers.length > 1 ? 'Live' : 'Solo'}
                </span>
              </div>
            </div>

            <div className="flex space-x-0.5">
              <Link to="/" className="px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-slate-800 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center space-x-2">
                <Calendar size={14} />
                <span>Roster</span>
              </Link>
              <Link to="/tracker" className="px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-slate-800 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center space-x-2">
                <BarChart2 size={14} />
                <span>Tracker</span>
              </Link>
              <Link to="/settings" className="px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-slate-800 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center space-x-2">
                <Settings size={14} />
                <span>Settings</span>
              </Link>
              <Link to="/logs" className="px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-slate-800 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center space-x-2">
                <Activity size={14} />
                <span>Monitor</span>
              </Link>
            </div>

            <div className="h-8 w-px bg-slate-300" />

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-slate-900 px-4 py-1.5 rounded-full border border-slate-900 shadow-md">
                <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[10px] text-slate-900 font-black">
                  {currentUser.charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] font-black text-white uppercase tracking-widest">{currentUser}</span>
              </div>
              <button 
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                title="Logout"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

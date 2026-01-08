import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, BarChart2, Settings, LogOut, Activity } from 'lucide-react';
import { socket } from '../utils/socket';

interface NavbarProps {
  currentUser: string;
  onLogout: () => void;
  onlineUsers: string[];
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onlineUsers }) => {
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
    <nav className="bg-teal-50/40 backdrop-blur-2xl border-b border-teal-200/20 shrink-0 sticky top-0 z-50 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-6">
        <div className="flex justify-between h-14 items-center">
          <div className="flex items-center space-x-4">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-600/20">Q</div>
            <span className="text-lg font-black text-slate-800 tracking-tight">QueueTracker</span>
            
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ml-2 border transition-colors ${isConnected ? 'bg-green-500/20 text-green-700 border-green-500/20' : 'bg-red-500/20 text-red-700 border-red-500/20'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {isConnected ? 'Sync Active' : 'Offline'}
            </div>
          </div>
          
          <div className="flex items-center space-x-8">
            {/* Online Users Indicator */}
            <div className="flex items-center gap-3 px-3 py-1.5 bg-teal-50/30 rounded-full border border-teal-200/20">
              <div className="flex -space-x-2">
                {[...new Set(onlineUsers.filter(u => u !== currentUser))].map((user, i) => (
                  <div 
                    key={i} 
                    className="group relative flex items-center bg-teal-50/50 border border-teal-200/30 rounded-full h-7 transition-all duration-500 hover:z-10 hover:pr-4 hover:pl-1 hover:space-x-3 overflow-hidden max-w-7 hover:max-w-50 shadow-sm cursor-default"
                  >
                    <div className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white bg-blue-500 shadow-sm">
                      {user.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-300 delay-100">
                      {user}
                    </span>
                  </div>
                ))}
                {onlineUsers.length <= 1 && (
                  <div className="w-7 h-7 rounded-full border border-dashed border-slate-400 flex items-center justify-center bg-teal-50/10">
                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 pr-1">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${onlineUsers.length > 1 ? 'bg-green-500' : 'bg-slate-500'}`} />
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                  {onlineUsers.length > 1 ? 'Live' : 'Solo'}
                </span>
              </div>
            </div>

            <div className="flex space-x-2">
              <Link to="/" className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:bg-teal-50/40 transition-all flex items-center space-x-2.5">
                <Calendar size={16} />
                <span>Roster</span>
              </Link>
              <Link to="/tracker" className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:bg-teal-50/40 transition-all flex items-center space-x-2.5">
                <BarChart2 size={16} />
                <span>Tracker</span>
              </Link>
              <Link to="/settings" className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:bg-teal-50/40 transition-all flex items-center space-x-2.5">
                <Settings size={16} />
                <span>Settings</span>
              </Link>
              <Link to="/logs" className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:bg-teal-50/40 transition-all flex items-center space-x-2.5">
                <Activity size={16} />
                <span>Monitor</span>
              </Link>
            </div>

            <div className="h-8 w-px bg-teal-200/30" />

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-teal-50/40 px-4 py-1.5 rounded-full border border-teal-200/30 shadow-sm">
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] text-white font-black shadow-md">
                  {currentUser.charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{currentUser}</span>
              </div>
              <button 
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50/50 rounded-xl transition-all"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

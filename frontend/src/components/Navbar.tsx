import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, BarChart2, Settings, LogOut, Wifi, WifiOff } from 'lucide-react';
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
    <nav className="bg-white border-b border-slate-200 shrink-0">
      <div className="max-w-screen-2xl mx-auto px-6">
        <div className="flex justify-between h-11 items-center">
          <div className="flex items-center space-x-3">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-base">Q</div>
            <span className="text-base font-black text-slate-800 tracking-tight">QueueTracker</span>
            
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ml-2 ${isConnected ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {isConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
              {isConnected ? 'Sync On' : 'Offline'}
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            {/* Online Users Indicator */}
            <div className="flex items-center gap-2 px-2 py-1 bg-slate-50/50 rounded-full border border-slate-100">
              <div className="flex -space-x-1.5">
                {[...new Set(onlineUsers.filter(u => u !== currentUser))].map((user, i) => (
                  <div 
                    key={i} 
                    className="group relative flex items-center bg-white border border-slate-200 rounded-full h-6 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:z-10 hover:pr-3 hover:pl-1 hover:space-x-2 overflow-hidden max-w-[24px] hover:max-w-[200px] shadow-sm cursor-default"
                  >
                    <div className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[8px] font-black text-white bg-slate-400">
                      {user.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[9px] font-black text-slate-700 uppercase tracking-wider whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-300 delay-100">
                      {user}
                    </span>
                  </div>
                ))}
                {onlineUsers.length <= 1 && (
                  <div className="w-5 h-5 rounded-full border border-dashed border-slate-200 flex items-center justify-center">
                    <div className="w-1 h-1 bg-slate-200 rounded-full" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 ml-1 pr-1">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  {onlineUsers.length > 1 ? 'Live' : 'Solo'}
                </span>
              </div>
            </div>

            <div className="flex space-x-1">
              <Link to="/" className="px-3 py-1.5 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-blue-600 transition-all flex items-center space-x-2">
                <Calendar size={14} />
                <span>Roster</span>
              </Link>
              <Link to="/tracker" className="px-3 py-1.5 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-blue-600 transition-all flex items-center space-x-2">
                <BarChart2 size={14} />
                <span>Tracker</span>
              </Link>
              <Link to="/settings" className="px-3 py-1.5 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-blue-600 transition-all flex items-center space-x-2">
                <Settings size={14} />
                <span>Settings</span>
              </Link>
            </div>

            <div className="h-6 w-px bg-slate-200" />

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200">
                <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-[10px] text-white font-black">
                  {currentUser.charAt(0).toUpperCase()}
                </div>
                <span className="text-[10px] font-black text-slate-700 uppercase tracking-wider">{currentUser}</span>
              </div>
              <button 
                onClick={onLogout}
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                title="Logout"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

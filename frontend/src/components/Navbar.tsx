import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, BarChart2, Settings, LogOut, Activity, Shield, Moon, Sun, LayoutDashboard } from 'lucide-react';
import { socket } from '../utils/socket';
import { useTheme } from '../theme/ThemeContext';
import { useRole } from '../auth/RoleContext';

interface NavbarProps {
  currentUser: string;
  onLogout: () => void;
  onlineUsers: string[];
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, onLogout, onlineUsers }) => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const { role, pages } = useRole();
  const { theme, toggle } = useTheme();

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
    <nav className="app-nav bg-[#222831] border-b border-[#222831]/80 shrink-0 sticky top-0 z-50 shadow-xl transition-colors duration-200">
      <div className="max-w-screen-2xl mx-auto px-6">
        <div className="flex justify-between h-14 items-center">
          <div className="flex items-center space-x-4">
            <div className="w-9 h-9 bg-[#393E46] rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg">P</div>
            <span className="nav-text text-lg font-normal text-white tracking-tight transition-colors duration-200">Productivity Tracker</span>
            
            <div className={`nav-pill flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ml-2 border transition-colors ${isConnected ? 'bg-[#00ADB5]/20 text-[#00ADB5] border-[#00ADB5]/40' : 'bg-red-500/20 text-red-400 border-red-500/40'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#00ADB5] animate-pulse' : 'bg-red-500'}`} />
              {isConnected ? 'Sync Active' : 'Offline'}
            </div>
          </div>
          
            <div className="flex items-center space-x-4">
            {/* Online Users Indicator - Iconic Expansion */}
            <div className="flex items-center gap-2.5 px-3 py-1 bg-white/10 rounded-full border border-white/20 mr-2 transition-all hover:bg-white/20 shadow-sm cursor-default group/online">
              <div className="flex items-center -space-x-3">
                {[...new Set(onlineUsers.filter(u => u !== currentUser))].map((user, i) => (
                  <div 
                    key={i} 
                    className="group/item flex items-center bg-[#393E46] rounded-full border-2 border-white shadow-md transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:z-30 hover:pr-4 hover:-space-x-0"
                    style={{ position: 'relative' }}
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0">
                      {user.charAt(0).toUpperCase()}
                    </div>
                    <span className="max-w-0 opacity-0 overflow-hidden text-[10px] font-black text-white uppercase tracking-widest transition-all duration-500 ease-out group-hover/item:max-w-[150px] group-hover/item:opacity-100 group-hover/item:ml-2">
                      {user}
                    </span>
                  </div>
                ))}
                {onlineUsers.filter(u => u !== currentUser).length === 0 && (
                  <div className="w-7 h-7 rounded-full border-2 border-dashed border-white/30 flex items-center justify-center bg-transparent group-hover/online:rotate-90 transition-transform duration-500">
                    <div className="w-2.5 h-2.5 bg-white/40 rounded-full animate-pulse" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 pl-0.5">
                <div className={`w-2.5 h-2.5 rounded-full ${onlineUsers.filter(u => u !== currentUser).length > 0 ? 'bg-[#00ADB5] animate-pulse shadow-[0_0_10px_rgba(0,173,181,0.6)]' : 'bg-white/40'}`} />
                <span className="text-[10px] font-black text-white uppercase tracking-[0.18em] leading-none">
                  {onlineUsers.filter(u => u !== currentUser).length > 0 ? 'Live' : 'Solo'}
                </span>
              </div>
            </div>

            <div className="flex space-x-0.5">
              {pages.admin && (
                <Link to="/home" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <LayoutDashboard size={14} />
                  <span>Home</span>
                </Link>
              )}
              {pages.roster && (
                <Link to="/" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <Calendar size={14} />
                  <span>Roster</span>
                </Link>
              )}
              {pages.stats && (
                <Link to="/tracker" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <BarChart2 size={14} />
                  <span>Tracker</span>
                </Link>
              )}
              {pages.settings && (
                <Link to="/settings" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <Settings size={14} />
                  <span>Settings</span>
                </Link>
              )}
              {pages.logMonitor && (
                <Link to="/logs" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <Activity size={14} />
                  <span>Monitor</span>
                </Link>
              )}
              {pages.admin && (
                <Link to="/admin" className="nav-item px-3 py-1.5 rounded-xl text-[10.5px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:bg-[#393E46] transition-all flex items-center space-x-2">
                  <Shield size={14} />
                  <span>Admin</span>
                </Link>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="nav-item w-8 h-8 rounded-xl flex items-center justify-center text-white/50 hover:text-white hover:bg-[#393E46] transition-all"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <div className="nav-divider h-8 w-px bg-white/20 transition-colors duration-200" />

            {/* Subtle credit */}
            <div className="flex flex-col items-end leading-none mr-1">
              <span className="nav-credit text-[7px] text-white/20 uppercase tracking-[0.2em] transition-colors duration-200">Designed &amp; developed with</span>
              <span className="text-[8px] font-black text-[#00ADB5]/60 tracking-widest uppercase">Shubham Kumar</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="nav-user flex items-center gap-3 bg-[#393E46] px-4 py-1.5 rounded-full border border-[#393E46] shadow-md transition-colors duration-200">
                <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[10px] text-[#222831] font-black">
                  {currentUser.charAt(0).toUpperCase()}
                </div>
                <span className="nav-text text-[11px] font-black text-white uppercase tracking-widest transition-colors duration-200">{currentUser}</span>
              </div>
              <button 
                onClick={onLogout}
                className="nav-item p-2 text-white/60 hover:text-white hover:bg-red-500 rounded-xl transition-all"
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

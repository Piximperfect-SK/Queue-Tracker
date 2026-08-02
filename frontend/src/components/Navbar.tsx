import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
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
  const { pages } = useRole();
  const { theme, toggle } = useTheme();
  const otherOnlineUsers = [...new Set(onlineUsers.filter((u) => u !== currentUser))];
  const visibleName = currentUser.length > 18 ? `${currentUser.slice(0, 18)}...` : currentUser;

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `nav-item inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
      isActive
        ? 'bg-white/14 text-white shadow-sm'
        : 'text-white/68 hover:text-white hover:bg-white/10'
    }`;

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
    <nav className="app-nav sticky top-0 z-50 shrink-0 border-b border-white/10 bg-[#222831]/96 shadow-lg backdrop-blur-xl transition-colors duration-200">
      <div className="mx-auto max-w-screen-2xl px-4">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="nav-avatar flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-base font-black text-white shadow-inner shadow-black/20">P</div>
            <div className="min-w-0">
              <div className="nav-text truncate text-[11px] font-black uppercase tracking-[0.22em] text-white/55">Productivity Suite</div>
              <div className="nav-text truncate text-[24px] font-semibold tracking-tight text-white leading-none">Tracker</div>
            </div>
            <div className={`nav-pill ml-1 hidden items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] md:inline-flex ${isConnected ? 'border-[#00ADB5]/35 bg-[#00ADB5]/12 text-[#65dbe1]' : 'border-red-400/30 bg-red-500/12 text-red-300'}`}>
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[#00ADB5] animate-pulse' : 'bg-red-400'}`} />
              {isConnected ? 'Sync Active' : 'Offline'}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <div className="hidden min-w-0 flex-1 justify-center xl:flex">
              <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/6 p-1.5 shadow-inner shadow-black/10">
                {pages.admin && (
                  <NavLink to="/home" className={navItemClass}>
                    <LayoutDashboard size={13} />
                    <span>Home</span>
                  </NavLink>
                )}
                {pages.roster && (
                  <NavLink to="/" end className={navItemClass}>
                    <Calendar size={13} />
                    <span>Roster</span>
                  </NavLink>
                )}
                {pages.stats && (
                  <NavLink to="/tracker" className={navItemClass}>
                    <BarChart2 size={13} />
                    <span>Tracker</span>
                  </NavLink>
                )}
                {pages.settings && (
                  <NavLink to="/settings" className={navItemClass}>
                    <Settings size={13} />
                    <span>Settings</span>
                  </NavLink>
                )}
                {pages.logMonitor && (
                  <NavLink to="/logs" className={navItemClass}>
                    <Activity size={13} />
                    <span>Monitor</span>
                  </NavLink>
                )}
                {pages.admin && (
                  <NavLink to="/admin" className={navItemClass}>
                    <Shield size={13} />
                    <span>Admin</span>
                  </NavLink>
                )}
              </div>
            </div>

            <div className="nav-pill hidden items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 lg:flex">
              <div className="flex -space-x-2">
                {otherOnlineUsers.slice(0, 3).map((user) => (
                  <div key={user} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/18 bg-white/10 text-[10px] font-black text-white shadow-sm">
                    {user.charAt(0).toUpperCase()}
                  </div>
                ))}
                {otherOnlineUsers.length === 0 && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-white/18 bg-transparent text-[9px] font-black text-white/40">0</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${otherOnlineUsers.length > 0 ? 'bg-[#00ADB5]' : 'bg-white/30'}`} />
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/82">
                  {otherOnlineUsers.length > 0 ? `${otherOnlineUsers.length} Live` : 'Solo'}
                </span>
              </div>
            </div>

            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="nav-item flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-white/65 transition-all hover:bg-white/12 hover:text-white"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <div className="nav-divider hidden h-8 w-px bg-white/12 lg:block" />

            <div className="nav-user flex items-center gap-3 rounded-2xl border border-white/10 bg-white/8 px-3 py-2 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[11px] font-black text-[#222831]">
                {currentUser.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/42">Signed In</div>
                <div className="nav-text truncate text-[14px] font-black uppercase tracking-[0.08em] text-white">{visibleName}</div>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="nav-item flex h-10 w-10 items-center justify-center rounded-2xl border border-transparent text-white/60 transition-all hover:border-red-400/30 hover:bg-red-500 hover:text-white"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

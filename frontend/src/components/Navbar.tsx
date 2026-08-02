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
  const hasOtherUsers = otherOnlineUsers.length > 0;

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `nav-item inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
      isActive
        ? 'bg-black/10 text-[var(--nav-text)] shadow-sm dark:bg-white/10 dark:text-white'
        : 'text-[var(--nav-text-soft)] hover:text-[var(--nav-text)] hover:bg-black/5 dark:hover:bg-white/10'
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
    <nav className="app-nav sticky top-0 z-50 shrink-0 border-b shadow-lg backdrop-blur-xl transition-colors duration-200" style={{ background: 'var(--nav-bg)', borderBottomColor: 'var(--nav-border)' }}>
      <div className="mx-auto max-w-screen-2xl px-4">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="nav-avatar flex h-10 w-10 items-center justify-center rounded-2xl text-base font-black shadow-inner shadow-black/10" style={{ background: 'rgba(0,0,0,0.08)', color: 'var(--nav-text)' }}>P</div>
            <div className="min-w-0">
              <div className="nav-text truncate text-[11px] font-black uppercase tracking-[0.22em]">Productivity Suite</div>
              <div className="nav-text truncate text-[24px] font-semibold tracking-tight leading-none">Tracker</div>
            </div>
            <div
              className={`nav-pill ml-1 hidden items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] md:inline-flex transition-all duration-200 ${isConnected ? 'border-emerald-400/30' : 'border-red-400/30'}`}
              style={{ background: 'var(--nav-pill-bg)', color: 'var(--nav-pill-text)', borderColor: isConnected ? 'rgba(16,185,129,0.28)' : 'rgba(248,113,113,0.32)' }}
            >
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
              {isConnected ? 'Sync Active' : 'Offline'}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <div className="hidden min-w-0 flex-1 justify-center xl:flex">
              <div className="flex items-center gap-1 rounded-2xl border p-1.5 shadow-inner shadow-black/10" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--nav-border)' }}>
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

            <div
              className="nav-pill group relative hidden items-center gap-2 rounded-full border px-3 py-1.5 lg:flex transition-all duration-200 hover:shadow-lg"
              style={{ background: 'var(--nav-pill-bg)', borderColor: 'var(--nav-pill-border)', color: 'var(--nav-pill-text)' }}
            >
              <div className="flex -space-x-2">
                {otherOnlineUsers.slice(0, 3).map((user) => (
                  <div key={user} className="flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-black shadow-sm" style={{ background: 'var(--nav-chip-bg)', borderColor: 'var(--nav-chip-border)', color: 'var(--nav-text)' }}>
                    {user.charAt(0).toUpperCase()}
                  </div>
                ))}
                {!hasOtherUsers && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed text-[9px] font-black" style={{ background: 'transparent', borderColor: 'var(--nav-chip-border)', color: 'var(--nav-text-muted)' }}>0</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hasOtherUsers ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <span className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: 'var(--nav-pill-text)' }}>
                  {hasOtherUsers ? `${otherOnlineUsers.length} Live` : 'Solo'}
                </span>
              </div>

              <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 opacity-0 translate-y-1 transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:translate-y-0">
                <div className="rounded-2xl border p-3 shadow-2xl backdrop-blur-xl" style={{ background: 'var(--nav-bg)', borderColor: 'var(--nav-border)', color: 'var(--nav-text)' }}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: 'var(--nav-text-muted)' }}>Logged In</p>
                      <p className="text-[12px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--nav-text)' }}>{hasOtherUsers ? `${otherOnlineUsers.length} other users` : 'Only you right now'}</p>
                    </div>
                    <span className="rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.2em]" style={{ background: 'var(--nav-chip-bg)', borderColor: 'var(--nav-chip-border)', color: 'var(--nav-text-muted)' }}>
                      Live
                    </span>
                  </div>
                  <div className="max-h-56 overflow-auto pr-1 scrollbar-hide">
                    {hasOtherUsers ? (
                      <div className="grid gap-2">
                        {otherOnlineUsers.map((user) => (
                          <div key={user} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ background: 'var(--nav-chip-bg)', borderColor: 'var(--nav-chip-border)' }}>
                            <div className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-black" style={{ background: 'rgba(0,0,0,0.08)', color: 'var(--nav-text)' }}>
                              {user.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-black uppercase tracking-[0.08em]" style={{ color: 'var(--nav-text)' }}>{user}</div>
                              <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: 'var(--nav-text-muted)' }}>Connected</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border px-3 py-3 text-[11px] font-semibold" style={{ background: 'var(--nav-chip-bg)', borderColor: 'var(--nav-chip-border)', color: 'var(--nav-text-muted)' }}>
                        No other users are connected.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="nav-item flex h-10 w-10 items-center justify-center rounded-2xl border transition-all hover:shadow-sm"
              style={{ background: 'var(--nav-pill-bg)', borderColor: 'var(--nav-pill-border)', color: 'var(--nav-pill-text)' }}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <div className="nav-divider hidden h-8 w-px lg:block" style={{ background: 'var(--nav-border)' }} />

            <div className="nav-user flex items-center gap-3 rounded-2xl border px-3 py-2 shadow-sm" style={{ background: 'var(--nav-pill-bg)', borderColor: 'var(--nav-pill-border)' }}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-black" style={{ background: 'rgba(0,0,0,0.1)', color: 'var(--nav-text)' }}>
                {currentUser.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="nav-credit text-[9px] font-black uppercase tracking-[0.18em]">Signed In</div>
                <div className="nav-text truncate text-[14px] font-black uppercase tracking-[0.08em]">{visibleName}</div>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="nav-item flex h-10 w-10 items-center justify-center rounded-2xl border border-transparent transition-all hover:border-red-400/30 hover:bg-red-500 hover:text-white"
              style={{ color: 'var(--nav-text-soft)' }}
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

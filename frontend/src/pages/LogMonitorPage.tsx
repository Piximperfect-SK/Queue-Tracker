import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Shield, Zap } from 'lucide-react';
import { socket } from '../utils/socket';
import type { LogEntry } from '../types';
import { getLogsForDate } from '../utils/logger';

const LogMonitorPage: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Load existing logs for today
    const todayStr = new Date().toISOString().split('T')[0];
    const initialLogs = getLogsForDate(todayStr);
    setLogs(initialLogs);

    const handleNewLog = ({ logEntry }: { dateStr: string; logEntry: LogEntry }) => {
      setLogs(prev => [...prev, logEntry].slice(-100)); // Keep last 100 logs for performance
    };

    socket.on('log_added', handleNewLog);

    return () => {
      socket.off('log_added', handleNewLog);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-full bg-white text-slate-950 font-mono rounded-4xl border border-white/40 flex flex-col overflow-hidden select-none shadow-xl">
      {/* Top Status Bar */}
      <div className="bg-slate-950 text-white px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <Terminal size={18} className="animate-pulse" />
          <h1 className="text-[10px] font-black uppercase tracking-[0.3em]">System Event Monitor v4.0</h1>
        </div>
        <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-2 px-2 py-1 bg-white/10 rounded">
            <div className={`w-1.5 h-1.5 rounded-full ${socket.connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span>Link: {socket.connected ? 'OK' : 'LOST'}</span>
          </div>
          <span className="px-3 py-1 border border-white rounded-full bg-white/20 text-white tracking-[0.2em] text-[8px]">
            LIVE
          </span>
        </div>
      </div>

      {/* Main Log Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-1.5 custom-scrollbar-light text-[11px] bg-slate-50/50"
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
            <Shield size={48} strokeWidth={1} />
            <p className="text-xs font-black uppercase tracking-[0.5em] animate-pulse">Awaiting Data...</p>
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-3 px-1 py-0.5 group">
              <span className="text-slate-400 shrink-0 select-none">[{log.timestamp}]</span>
              <span className="text-blue-600 shrink-0 font-black">[{log.user}]</span>
              <span className={`shrink-0 font-black uppercase tracking-wider ${
                log.type === 'positive' ? 'text-green-600' : 
                log.type === 'negative' ? 'text-red-600' : 
                'text-slate-900'
              }`}>{log.action}:</span>
              <span className={`break-all font-bold ${
                log.type === 'positive' ? 'text-green-700/90' : 
                log.type === 'negative' ? 'text-red-700/90' : 
                'text-slate-700'
              }`}>{log.details}</span>
              {i === logs.length - 1 && (
                <span className="w-1.5 h-4 bg-slate-900 animate-pulse inline-block align-middle ml-1" />
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer / System Info */}
      <div className="bg-slate-100 border-t border-slate-200 px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex gap-6">
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-500 font-black uppercase tracking-widest">Uplink ID</p>
            <p className="text-[9px] font-black text-slate-900">{socket.id?.slice(0, 12).toUpperCase() || 'OFFLINE'}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[7px] text-slate-500 font-black uppercase tracking-widest">Buffer</p>
            <p className="text-[9px] font-black text-slate-900">{logs.length}/100</p>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-60">
          <Zap size={10} className="text-amber-600" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Classified Access Only</p>
        </div>
      </div>

      <style>{`
        .custom-scrollbar-light::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar-light::-webkit-scrollbar-track {
          background: #f8fafc;
        }
        .custom-scrollbar-light::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar-light::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
};

export default LogMonitorPage;

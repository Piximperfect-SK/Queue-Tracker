import { io } from 'socket.io-client';
import type { Handler, RosterEntry, DailyStats } from '../types';
import type { LogEntry } from '../types';
import { getToken } from './authToken';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

console.log('--- SOCKET CONFIG ---');
console.log('Target URL:', SOCKET_URL);
console.log('Mode:', import.meta.env.MODE);
console.log('---------------------');

export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  withCredentials: true,
  auth: (cb) => cb({ token: getToken() }),
});

type Ack = (res: { ok: boolean; error?: string; total?: number; handlers?: number; roster?: number }) => void;

export const syncData = {
  join: (username: string) => socket.emit('join', { username }),
  updateHandlers: (handlers: Handler[]) => socket.emit('update_handlers', handlers),
  updateRoster:   (roster: RosterEntry[]) => socket.emit('update_roster', roster),
  updateStats:    (stats: DailyStats[]) => socket.emit('update_stats', stats),
  addLog:         (logEntry: LogEntry) => socket.emit('add_log', logEntry),

  // Bulk import — merges into MongoDB without overwriting unrelated data
  updateStatsImport: (rows: DailyStats[], cb?: Ack) =>
    socket.emit('update_stats_import', { rows, replaceByDate: true }, cb),
  updateHandlersImport: (handlers: Handler[], roster: RosterEntry[], cb?: Ack) =>
    socket.emit('update_handlers_import', { handlers, roster }, cb),
};

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
  transports: ['websocket', 'polling'], // Fallback to polling if websocket fails
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  withCredentials: true,
  // Called fresh before every connection attempt, so a token set AFTER the
  // socket module first loaded (e.g. right after login) is still picked up
  // without needing to manually mutate socket.auth beforehand.
  auth: (cb) => cb({ token: getToken() }),
});

type Ack = (res: { ok: boolean; error?: string }) => void;

export const syncData = {
  join: (username: string) => socket.emit('join', { username }),
  updateHandlers: (handlers: Handler[], cb?: Ack) => socket.emit('update_handlers', handlers, cb),
  updateRoster: (roster: RosterEntry[], cb?: Ack) => socket.emit('update_roster', roster, cb),
  updateStats: (stats: DailyStats[], cb?: Ack) => socket.emit('update_stats', stats, cb),
  addLog: (logEntry: LogEntry) => socket.emit('add_log', logEntry),
};

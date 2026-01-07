import { io } from 'socket.io-client';

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
});

export const syncData = {
  join: (username: string, accessKey: string) => socket.emit('join', { username, accessKey }),
  updateAgents: (agents: any) => socket.emit('update_agents', agents),
  updateRoster: (roster: any) => socket.emit('update_roster', roster),
  updateStats: (stats: any) => socket.emit('update_stats', stats),
  addLog: (logEntry: any) => socket.emit('add_log', logEntry),
};

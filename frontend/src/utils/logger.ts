import type { LogEntry } from '../types';
import { syncData } from './socket';

export const addLog = (action: string, details: string, type: 'positive' | 'negative' | 'neutral' = 'neutral') => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const logKey = `logs_${dateStr}`;
  const user = localStorage.getItem('currentUser') || 'Unknown User';
  
  const newEntry: LogEntry = {
    timestamp: now.toLocaleTimeString(),
    user,
    action,
    details,
    type
  };

  syncData.addLog(newEntry);

  try {
    const existingLogs = localStorage.getItem(logKey);
    const logs: LogEntry[] = existingLogs ? JSON.parse(existingLogs) : [];
    logs.push(newEntry);
    localStorage.setItem(logKey, JSON.stringify(logs));
    console.log(`[LOG] ${newEntry.timestamp} - ${user} - ${action}: ${details}`);
  } catch (e) {
    console.error('Failed to save log', e);
  }
};

export const getLogsForDate = (dateStr: string): LogEntry[] => {
  try {
    const logs = localStorage.getItem(`logs_${dateStr}`);
    return logs ? JSON.parse(logs) : [];
  } catch (e) {
    return [];
  }
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const downloadLogsForDate = (dateStr: string) => {
  // Use the server endpoint for more reliable downloading
  window.open(`${BACKEND_URL}/download-logs/${dateStr}`, '_blank');
};

export const downloadAllLogs = () => {
  // Use the server endpoint for more reliable downloading
  window.open(`${BACKEND_URL}/download-all-logs`, '_blank');
};

export const saveLogsFromServer = (allLogs: { [date: string]: LogEntry[] }) => {
  if (!allLogs) return;
  try {
    Object.entries(allLogs).forEach(([date, logs]) => {
      if (Array.isArray(logs)) {
        localStorage.setItem(`logs_${date}`, JSON.stringify(logs));
      }
    });
    console.log('[SYNC] Logs synchronized from server');
  } catch (e) {
    console.error('Failed to sync logs from server', e);
  }
};

export const saveSingleLogFromServer = (dateStr: string, logEntry: LogEntry) => {
  try {
    const logKey = `logs_${dateStr}`;
    const existingLogs = localStorage.getItem(logKey);
    const logs: LogEntry[] = existingLogs ? JSON.parse(existingLogs) : [];
    
    // Avoid duplicates if we already have this log (e.g. we were the one who sent it)
    const isDuplicate = logs.some(l => 
      l.timestamp === logEntry.timestamp && 
      l.user === logEntry.user && 
      l.action === logEntry.action && 
      l.details === logEntry.details
    );

    if (!isDuplicate) {
      logs.push(logEntry);
      localStorage.setItem(logKey, JSON.stringify(logs));
    }
  } catch (e) {
    console.error('Failed to save single log from server', e);
  }
};

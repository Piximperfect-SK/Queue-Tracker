export interface LogEntry {
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

export type ShiftType = 
  | '6AM-3PM' 
  | '1PM-10PM' 
  | '2PM-11PM' 
  | '10PM-7AM' 
  | 'WO' 
  | 'ML' 
  | 'PL' 
  | 'EL' 
  | 'UL' 
  | 'CO' 
  | 'MID-LEAVE';

export interface Agent {
  id: string;
  name: string;
  isQH: boolean;
}

export interface RosterEntry {
  agentId: string;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
}

export interface DailyStats {
  agentId: string;
  date: string;
  incidents: number;
  sctasks: number;
  calls: number;
  comments: string;
}

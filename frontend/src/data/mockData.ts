import type { Agent, ShiftType, RosterEntry } from '../types';

export const MOCK_AGENTS: Agent[] = [
  { id: '1', name: 'Nadeer Muhammad', isQH: true },
  { id: '2', name: 'Santosh Guttedar', isQH: false },
  { id: '3', name: 'Nisha Nigam', isQH: true },
  { id: '4', name: 'Shubham Kumar', isQH: true },
  { id: '5', name: 'Divya Tanu Raj', isQH: false },
  { id: '6', name: 'Amit Sharma', isQH: true },
  { id: '7', name: 'Priya Singh', isQH: false },
  { id: '8', name: 'Rahul Verma', isQH: true },
  { id: '9', name: 'Suresh Raina', isQH: false },
  { id: '10', name: 'Deepak Chahar', isQH: true },
  { id: '11', name: 'Rishabh Pant', isQH: false },
  { id: '12', name: 'Hardik Pandya', isQH: true },
];

export const SHIFTS: ShiftType[] = ['6AM-3PM', '1PM-10PM', '2PM-11PM', '10PM-7AM'];

// Sample Roster for a few days
export const MOCK_ROSTER: RosterEntry[] = [];

const today = new Date().toISOString().split('T')[0];
const dates = [today, '2026-01-05', '2026-01-06', '2026-01-07'];

dates.forEach(date => {
  MOCK_AGENTS.forEach((agent, index) => {
    let shift: ShiftType = '6AM-3PM';
    if (index >= 3 && index < 6) shift = '1PM-10PM';
    if (index >= 6 && index < 9) shift = '2PM-11PM';
    if (index >= 9) shift = '10PM-7AM';
    
    // Add some variety (WO)
    if ((index + new Date(date).getDate()) % 7 === 0) {
      shift = 'WO';
    }

    MOCK_ROSTER.push({
      agentId: agent.id,
      date,
      shift
    });
  });
});

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRole } from '../auth/RoleContext';
import type { Handler, RosterEntry, DailyStats } from '../types';
import { syncData, socket } from '../utils/socket';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import * as XLSX from 'xlsx';
import {
  Users, Activity, ChevronLeft, ChevronRight,
  BarChart2, Shield, Calendar, ArrowUp, ArrowDown, Download,
  Search, ChevronUp, ChevronDown, Minus, Upload, Lock, X,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
type FilterMode = 'day' | 'month' | 'year';
type TabId = 'overview' | 'agents' | 'qh' | 'shifts' | 'leave';

const LEAVE_TYPES = new Set([
  'WeekOff','Medical Leave','Planned Leave','Earned Leave',
  'Unplanned Leave','Complimentary Off','MID-LEAVE',
]);
const ACTIVE_SHIFTS = ['6AM-3PM','12PM-9PM','1PM-10PM','2PM-11PM','10PM-7AM'];
const MONTH_NAMES   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const INC_C  = '#3b82f6';
const TASK_C = '#f59e0b';
const CALL_C = '#00ADB5';
const SHIFT_COLORS: Record<string, string> = {
  '6AM-3PM':'#3b82f6','12PM-9PM':'#eab308','1PM-10PM':'#f97316',
  '2PM-11PM':'#ef4444','10PM-7AM':'#8b5cf6',
};
const SHIFT_PALETTE = ['#3b82f6','#eab308','#f97316','#ef4444','#8b5cf6','#10b981','#ec4899'];
const LEAVE_COLORS  = ['#64748b','#ec4899','#f59e0b','#ef4444','#94a3b8','#10b981','#8b5cf6'];

const monthOf = (d: string) => d.slice(0,7);
const yearOf  = (d: string) => d.slice(0,4);
const fmt     = (n: number) => n.toLocaleString();
const pct     = (a: number, b: number) => b > 0 ? Math.round((a/b)*100) : 0;
const pctChange = (curr: number, prev: number) => prev > 0 ? Math.round(((curr-prev)/prev)*100) : (curr > 0 ? 100 : 0);

type ImportFeedback = { message: string; tone: 'success' | 'warning' | 'error' };
type RefinedAnalyticsRow = {
  agentName: string;
  date: string;
  shift: string;
  shiftTiming: string;
  incidents: number;
  sctasks: number;
  calls: number;
  p1p2vip: number;
  comments: string;
  totalHandled: number;
  endorsementTickets: number;
  grandTotal: number;
  sourceSheet: string;
  sourceRow: number;
  importStatus: 'Ready';
  dataQualityNotes: string;
};

const normalizeCellValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
};

const parseExcelDate = (value: unknown) => {
  if (typeof value === 'number') {
    const parseDateCode = (XLSX as any).SSF?.parse_date_code;
    if (typeof parseDateCode === 'function') {
      const decoded = parseDateCode(value);
      if (decoded?.y && decoded?.m && decoded?.d) {
        return `${decoded.y}-${String(decoded.m).padStart(2, '0')}-${String(decoded.d).padStart(2, '0')}`;
      }
    }
  }
  const formatted = normalizeCellValue(value);
  if (!formatted) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  const parsed = new Date(formatted);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return null;
};

const mergeStatsEntries = (base: DailyStats[], additions: DailyStats[]) => {
  const merged = [...base];
  additions.forEach((entry) => {
    const idx = merged.findIndex((s) => s.handlerId === entry.handlerId && s.date === entry.date);
    if (idx > -1) merged[idx] = entry;
    else merged.push(entry);
  });
  return merged;
};

const createAgentId = () => {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

const parseNumberCell = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = normalizeCellValue(value).replace(/,/g, '');
  if (!str) return 0;
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
};

const isLikelyNameText = (value: unknown) => {
  const v = normalizeCellValue(value);
  if (!v) return false;
  if (parseExcelDate(v)) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/^(inc|incident|task|request|call|date|day|shift)$/i.test(v)) return false;
  return true;
};

const findColumnIndex = (headers: string[], keywords: string[]) =>
  headers.findIndex((h) => keywords.some((k) => h.includes(k)));

const SERVER_ACK_TIMEOUT_MS = 30000;

const verifyImportedStatsOnServer = (expectedRows: DailyStats[]) =>
  new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const timer = setTimeout(() => {
      socket.off('init', onInit);
      resolve({ ok: false, detail: 'verification request timed out' });
    }, 15000);

    const sample = expectedRows.slice(0, 250);
    const sampleKeys = new Set(sample.map((r) => `${r.handlerId}|${r.date}|${r.incidents}|${r.sctasks}|${r.calls}`));

    const onInit = (db: any) => {
      clearTimeout(timer);
      const serverStats: DailyStats[] = Array.isArray(db?.stats) ? db.stats : [];
      const serverKeys = new Set(serverStats.map((r) => `${r.handlerId}|${r.date}|${Number(r.incidents || 0)}|${Number(r.sctasks || 0)}|${Number(r.calls || 0)}`));
      let matched = 0;
      sampleKeys.forEach((k) => { if (serverKeys.has(k)) matched += 1; });
      const ratio = sampleKeys.size ? matched / sampleKeys.size : 0;
      resolve({ ok: ratio >= 0.95, detail: `matched ${matched}/${sampleKeys.size} sample rows` });
    };

    socket.once('init', onInit);
    socket.emit('get_initial_data');
  });

const parseDateFromSheetName = (sheetName: string, fallbackYear: number) => {
  const raw = normalizeCellValue(sheetName);
  if (!raw) return null;

  const direct = parseExcelDate(raw);
  if (direct) return direct;

  const cleaned = raw
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withYearMatch = cleaned.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{4})/i);
  const noYearMatch = cleaned.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})/i);

  const months: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const day = Number((withYearMatch ?? noYearMatch)?.[1] ?? NaN);
  const monthToken = ((withYearMatch ?? noYearMatch)?.[2] ?? '').toLowerCase();
  const month = months[monthToken];
  const year = withYearMatch ? Number(withYearMatch[3]) : fallbackYear;

  if (!Number.isFinite(day) || !month || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  label: string; value: string | number; sub?: string;
  Icon?: React.FC<{size?:number;color?:string}>;
  color: string; bg?: string; border?: string; trend?: number;
}> = ({ label, value, sub, color, trend }) => (
  <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderLeft:`3px solid ${color}`, borderRadius:6, padding:'12px 14px', display:'flex', flexDirection:'column', gap:5, minWidth:0 }}>
    <span style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</span>
    <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
      <span style={{ fontSize:24, fontWeight:700, color:'#0f172a', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{value}</span>
      {trend !== undefined && trend !== 0 && (
        <span style={{ fontSize:11, fontWeight:600, color: trend>0?'#16a34a':'#dc2626', display:'flex', alignItems:'center', gap:2 }}>
          {trend>0 ? <ArrowUp size={10}/> : <ArrowDown size={10}/>}{Math.abs(trend)}%
        </span>
      )}
    </div>
    {sub && <span style={{ fontSize:10, color:'#94a3b8' }}>{sub}</span>}
  </div>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background:'#fff', borderRadius:6, border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', overflow:'hidden', ...style }}>
    {children}
  </div>
);

const CardHead: React.FC<{ sup: string; title: string; right?: React.ReactNode }> = ({ sup, title, right }) => (
  <div style={{ flexShrink:0, padding:'10px 14px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
    <div>
      <div style={{ fontSize:8, color:'#94a3b8', fontWeight:900, textTransform:'uppercase', letterSpacing:'0.2em' }}>{sup}</div>
      <div style={{ fontSize:12, fontWeight:900, color:'#0f172a', marginTop:2 }}>{title}</div>
    </div>
    {right && <div style={{ paddingTop:2 }}>{right}</div>}
  </div>
);

const Empty: React.FC<{ msg?: string }> = ({ msg='No data for this period' }) => (
  <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, opacity:0.2, minHeight:80 }}>
    <BarChart2 size={24} strokeWidth={1} color="#94a3b8"/>
    <span style={{ fontSize:9, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.15em' }}>{msg}</span>
  </div>
);

const TT = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 12px', boxShadow:'0 4px 12px rgba(0,0,0,0.1)', fontSize:11 }}>
      <div style={{ fontWeight:900, color:'#0f172a', marginBottom:4 }}>{label}</div>
      {payload.map((p:any,i:number) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, color:p.color||'#374151', fontWeight:700 }}>
          <div style={{ width:8, height:8, borderRadius:2, background:p.color||'#374151', flexShrink:0 }}/>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

const PieTT = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 10px', boxShadow:'0 4px 12px rgba(0,0,0,0.1)', fontSize:11 }}>
      <span style={{ fontWeight:900, color:'#0f172a' }}>{payload[0].name}: </span>
      <span style={{ fontWeight:700, color:payload[0].payload.fill }}>{fmt(payload[0].value)}</span>
    </div>
  );
};

const LegendDot: React.FC<{color:string;label:string;type?:'dot'|'line'}> = ({color,label,type='dot'}) => (
  <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:9, fontWeight:700, color:'#64748b' }}>
    {type==='line'
      ? <div style={{ width:14, height:2, borderRadius:1, background:color }}/>
      : <div style={{ width:8, height:8, borderRadius:2, background:color }}/>
    }
    {label}
  </div>
);

const SortIcon: React.FC<{col:string;active:string;dir:'asc'|'desc'}> = ({col,active,dir}) => {
  if (active !== col) return <Minus size={10} color="#cbd5e1"/>;
  return dir==='asc' ? <ChevronUp size={10} color="#0f172a"/> : <ChevronDown size={10} color="#0f172a"/>;
};

const Badge: React.FC<{label:string;color:string;bg:string;border:string}> = ({label,color,bg,border}) => (
  <span style={{ fontSize:8, fontWeight:900, color, background:bg, border:`1px solid ${border}`, borderRadius:4, padding:'1px 6px', textTransform:'uppercase', letterSpacing:'0.1em', whiteSpace:'nowrap' }}>
    {label}
  </span>
);

// ══════════════════════════════════════════════════════════════════════════════
const HomePage: React.FC = () => {
  const { role, actions } = useRole();
  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);

  const [mode,          setMode]          = useState<FilterMode>('month');
  const [selectedDay,   setSelectedDay]   = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0,7));
  const [selectedYear,  setSelectedYear]  = useState(today.slice(0,4));
  const [activeTab,     setActiveTab]     = useState<TabId>('overview');
  const [agentSearch,   setAgentSearch]   = useState('');
  const [sortCol,       setSortCol]       = useState<string>('total');
  const [sortDir,       setSortDir]       = useState<'asc'|'desc'>('desc');

  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [roster,   setRoster]   = useState<RosterEntry[]>([]);
  const [stats,    setStats]    = useState<DailyStats[]>([]);
  const [importStatus, setImportStatus] = useState<ImportFeedback | null>(null);
  const [isImportingAnalytics, setIsImportingAnalytics] = useState(false);
  const [isRefineModalOpen, setIsRefineModalOpen] = useState(false);
  const [isRefiningAnalytics, setIsRefiningAnalytics] = useState(false);
  const [refinedRows, setRefinedRows] = useState<RefinedAnalyticsRow[]>([]);
  const [refineWarnings, setRefineWarnings] = useState<string[]>([]);
  const [refineSourceName, setRefineSourceName] = useState('');
  const [importProgress, setImportProgress] = useState<{ step: string; percent: number; mode: 'import' | 'both' | null } | null>(null);
  const analyticsFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = () => {
      try { const h=JSON.parse(localStorage.getItem('handlers')||'[]'); if(h.length) setHandlers(h); } catch {}
      try { const r=JSON.parse(localStorage.getItem('roster')  ||'[]'); if(r.length) setRoster(r);   } catch {}
      try { const s=JSON.parse(localStorage.getItem('stats')   ||'[]'); if(s.length) setStats(s);    } catch {}
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const handlerMap = useMemo(() => { const m=new Map<string,Handler>(); handlers.forEach(h=>m.set(h.id,h)); return m; }, [handlers]);

  const inPeriod = useCallback((date: string) => {
    if (mode==='day')   return date === selectedDay;
    if (mode==='month') return monthOf(date) === selectedMonth;
    return yearOf(date) === selectedYear;
  }, [mode, selectedDay, selectedMonth, selectedYear]);

  const filteredStats  = useMemo(() => stats.filter(s => inPeriod(s.date)),  [stats,  inPeriod]);
  const filteredRoster = useMemo(() => roster.filter(r => inPeriod(r.date)), [roster, inPeriod]);

  const totalInc   = filteredStats.reduce((a,s)=>a+Number(s.incidents||0),0);
  const totalTask  = filteredStats.reduce((a,s)=>a+Number(s.sctasks  ||0),0);
  const totalCalls = filteredStats.reduce((a,s)=>a+Number(s.calls    ||0),0);
  const grandTotal = totalInc+totalTask+totalCalls;

  const activeCount = useMemo(() =>
    new Set(filteredRoster.filter(r=>!LEAVE_TYPES.has(r.shift)).map(r=>r.handlerId)).size,
  [filteredRoster]);

  const leaveCount = useMemo(() =>
    new Set(filteredRoster.filter(r=>LEAVE_TYPES.has(r.shift)).map(r=>r.handlerId)).size,
  [filteredRoster]);

  const qhCount = handlers.filter(h=>h.isQH).length;

  // ── Previous period (for trend deltas) ────────────────────────────────────
  const prevPeriodKey = useMemo(() => {
    if (mode==='day')   { const [y,m,d]=selectedDay.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()-1); return dt.toLocaleDateString('en-CA'); }
    if (mode==='month') { const [y,m]=selectedMonth.split('-').map(Number); const dt=new Date(y,m-2,1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
    return String(+selectedYear-1);
  }, [mode, selectedDay, selectedMonth, selectedYear]);

  const inPrevPeriod = useCallback((date: string) => {
    if (mode==='day')   return date === prevPeriodKey;
    if (mode==='month') return monthOf(date) === prevPeriodKey;
    return yearOf(date) === prevPeriodKey;
  }, [mode, prevPeriodKey]);

  const prevFilteredStats  = useMemo(() => stats.filter(s => inPrevPeriod(s.date)),  [stats,  inPrevPeriod]);
  const prevFilteredRoster = useMemo(() => roster.filter(r => inPrevPeriod(r.date)), [roster, inPrevPeriod]);

  const prevTotalInc   = prevFilteredStats.reduce((a,s)=>a+Number(s.incidents||0),0);
  const prevTotalTask  = prevFilteredStats.reduce((a,s)=>a+Number(s.sctasks  ||0),0);
  const prevTotalCalls = prevFilteredStats.reduce((a,s)=>a+Number(s.calls    ||0),0);
  const prevGrandTotal = prevTotalInc+prevTotalTask+prevTotalCalls;

  const prevActiveCount = useMemo(() =>
    new Set(prevFilteredRoster.filter(r=>!LEAVE_TYPES.has(r.shift)).map(r=>r.handlerId)).size,
  [prevFilteredRoster]);

  // ── Attendance rate: % of scheduled agent-days actually worked (not on leave) ──
  const attendanceRate = useMemo(() =>
    filteredRoster.length ? pct(filteredRoster.filter(r=>!LEAVE_TYPES.has(r.shift)).length, filteredRoster.length) : 0,
  [filteredRoster]);
  const prevAttendanceRate = useMemo(() =>
    prevFilteredRoster.length ? pct(prevFilteredRoster.filter(r=>!LEAVE_TYPES.has(r.shift)).length, prevFilteredRoster.length) : 0,
  [prevFilteredRoster]);

  const agentStats = useMemo(() => {
    const map: Record<string,{inc:number;task:number;calls:number;days:Set<string>}> = {};
    filteredStats.forEach(s => {
      if (!map[s.handlerId]) map[s.handlerId] = {inc:0,task:0,calls:0,days:new Set()};
      map[s.handlerId].inc   += Number(s.incidents||0);
      map[s.handlerId].task  += Number(s.sctasks  ||0);
      map[s.handlerId].calls += Number(s.calls    ||0);
      map[s.handlerId].days.add(s.date);
    });
    return map;
  }, [filteredStats]);

  const agentRows = useMemo(() => {
    return handlers
      .filter(h => !agentSearch || h.name.toLowerCase().includes(agentSearch.toLowerCase()))
      .map(h => {
        const s  = agentStats[h.id] || {inc:0,task:0,calls:0,days:new Set()};
        const total = s.inc+s.task+s.calls;
        const perDay = s.days.size > 0 ? +(total/s.days.size).toFixed(1) : 0;
        const shift = filteredRoster.find(r=>r.handlerId===h.id&&!LEAVE_TYPES.has(r.shift))?.shift || '—';
        const onLeave = filteredRoster.some(r=>r.handlerId===h.id&&LEAVE_TYPES.has(r.shift));
        return { id:h.id, name:h.name, isQH:h.isQH, inc:s.inc, task:s.task, calls:s.calls, total, perDay, days:s.days.size, shift, onLeave };
      })
      .sort((a,b) => {
        const v = (x:any) => typeof x[sortCol]==='string' ? x[sortCol].toLowerCase() : (x[sortCol]||0);
        return sortDir==='asc' ? (v(a)>v(b)?1:-1) : (v(a)<v(b)?1:-1);
      });
  }, [handlers, agentStats, filteredRoster, agentSearch, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const barData = useMemo(() => {
    if (mode==='day') {
      return filteredStats
        .map(s => ({
          label: (handlerMap.get(s.handlerId)?.name||'').split(' ')[0]||'?',
          INC:   Number(s.incidents||0),
          TASK:  Number(s.sctasks  ||0),
          CALLS: Number(s.calls    ||0),
        }))
        .filter(d=>d.INC+d.TASK+d.CALLS>0)
        .sort((a,b)=>(b.INC+b.TASK+b.CALLS)-(a.INC+a.TASK+a.CALLS))
        .slice(0,14);
    }
    if (mode==='month') {
      const days: Record<string,{INC:number;TASK:number;CALLS:number}> = {};
      stats.filter(s=>monthOf(s.date)===selectedMonth).forEach(s=>{
        if(!days[s.date]) days[s.date]={INC:0,TASK:0,CALLS:0};
        days[s.date].INC   += Number(s.incidents||0);
        days[s.date].TASK  += Number(s.sctasks  ||0);
        days[s.date].CALLS += Number(s.calls    ||0);
      });
      return Object.entries(days).sort(([a],[b])=>a.localeCompare(b)).map(([d,v])=>({label:d.slice(8),...v}));
    }
    const months: Record<string,{INC:number;TASK:number;CALLS:number}> = {};
    stats.filter(s=>yearOf(s.date)===selectedYear).forEach(s=>{
      const mk=monthOf(s.date);
      if(!months[mk]) months[mk]={INC:0,TASK:0,CALLS:0};
      months[mk].INC   += Number(s.incidents||0);
      months[mk].TASK  += Number(s.sctasks  ||0);
      months[mk].CALLS += Number(s.calls    ||0);
    });
    return Object.entries(months).sort(([a],[b])=>a.localeCompare(b)).map(([m,v])=>({label:MONTH_NAMES[parseInt(m.slice(5))-1],...v}));
  }, [filteredStats, stats, handlerMap, mode, selectedMonth, selectedYear]);

  const shiftDist = useMemo(() => {
    const map: Record<string,number> = {};
    filteredRoster.filter(r=>!LEAVE_TYPES.has(r.shift)).forEach(r=>{map[r.shift]=(map[r.shift]||0)+1;});
    return Object.entries(map).map(([name,value],i)=>({name,value,fill:SHIFT_COLORS[name]||SHIFT_PALETTE[i%SHIFT_PALETTE.length]}));
  }, [filteredRoster]);

  const leaveDist = useMemo(() => {
    const map: Record<string,number> = {};
    filteredRoster.filter(r=>LEAVE_TYPES.has(r.shift)).forEach(r=>{map[r.shift]=(map[r.shift]||0)+1;});
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([label,value],i)=>({label,value,color:LEAVE_COLORS[i%LEAVE_COLORS.length]}));
  }, [filteredRoster]);

  const topPerformers = useMemo(() =>
    [...agentRows].filter(r=>r.total>0).sort((a,b)=>b.perDay-a.perDay).slice(0,5),
  [agentRows]);

  const qhRows  = useMemo(() => agentRows.filter(r=>r.isQH),  [agentRows]);
  const stdRows = useMemo(() => agentRows.filter(r=>!r.isQH), [agentRows]);

  const shiftAnalysis = useMemo(() => {
    return ACTIVE_SHIFTS.map(shift => {
      const ids = new Set(filteredRoster.filter(r=>r.shift===shift).map(r=>r.handlerId));
      const s   = filteredStats.filter(s=>ids.has(s.handlerId));
      const inc  = s.reduce((a,x)=>a+Number(x.incidents||0),0);
      const task = s.reduce((a,x)=>a+Number(x.sctasks  ||0),0);
      const calls= s.reduce((a,x)=>a+Number(x.calls    ||0),0);
      return { shift, agents:ids.size, inc, task, calls, total:inc+task+calls };
    });
  }, [filteredRoster, filteredStats]);

  const periodLabel = useMemo(() => {
    if(mode==='day') return new Date(selectedDay+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    if(mode==='month'){const[y,m]=selectedMonth.split('-');return new Date(+y,+m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});}
    return selectedYear;
  },[mode,selectedDay,selectedMonth,selectedYear]);

  const navPeriod=(dir:number)=>{
    if(mode==='day'){const[y,m,d]=selectedDay.split('-').map(Number);const dt=new Date(y,m-1,d);dt.setDate(dt.getDate()+dir);setSelectedDay(dt.toLocaleDateString('en-CA'));}
    else if(mode==='month'){const[y,m]=selectedMonth.split('-').map(Number);const dt=new Date(y,m-1+dir,1);setSelectedMonth(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`);}
    else setSelectedYear(String(+selectedYear+dir));
  };

  const exportReport = useCallback(() => {
    const wb = XLSX.utils.book_new();

    const summaryAoA = [
      ['Queue Tracker — Productivity Report'],
      ['Period', periodLabel],
      ['Generated', new Date().toLocaleString('en-US')],
      [],
      ['Metric', 'Current', `Previous ${mode}`, 'Change'],
      ['Active Agents',   activeCount,           prevActiveCount,      `${pctChange(activeCount, prevActiveCount)}%`],
      ['Attendance Rate', `${attendanceRate}%`,  `${prevAttendanceRate}%`, `${pctChange(attendanceRate, prevAttendanceRate)}%`],
      ['Incidents',       totalInc,              prevTotalInc,          `${pctChange(totalInc, prevTotalInc)}%`],
      ['SC Tasks',        totalTask,             prevTotalTask,         `${pctChange(totalTask, prevTotalTask)}%`],
      ['Calls',           totalCalls,            prevTotalCalls,        `${pctChange(totalCalls, prevTotalCalls)}%`],
      ['Grand Total',     grandTotal,            prevGrandTotal,        `${pctChange(grandTotal, prevGrandTotal)}%`],
      ['Total Agents (registered)', handlers.length, '', ''],
      ['Queue Handlers',  qhCount, '', ''],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoA), 'Summary');

    const agentAoA = [
      ['Agent','QH','Incidents','SC Tasks','Calls','Total','Days Worked','Avg / Day','Current Shift','On Leave'],
      ...agentRows.map(r => [r.name, r.isQH?'Yes':'No', r.inc, r.task, r.calls, r.total, r.days, r.perDay, r.shift, r.onLeave?'Yes':'No']),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agentAoA), 'Agent Detail');

    const shiftAoA = [
      ['Shift','Agents','Incidents','SC Tasks','Calls','Total','Avg / Agent'],
      ...shiftAnalysis.map(s => [s.shift, s.agents, s.inc, s.task, s.calls, s.total, s.agents>0?+(s.total/s.agents).toFixed(1):0]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shiftAoA), 'Shift Breakdown');

    const leaveAoA = [
      ['Leave Type','Count'],
      ...leaveDist.map(l => [l.label, l.value]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(leaveAoA), 'Leave Breakdown');

    const safePeriod = String(periodLabel).replace(/[^\w-]+/g, '_');
    XLSX.writeFile(wb, `Queue-Tracker-Report-${safePeriod}.xlsx`);
  }, [
    periodLabel, mode, activeCount, prevActiveCount, attendanceRate, prevAttendanceRate,
    totalInc, prevTotalInc, totalTask, prevTotalTask, totalCalls, prevTotalCalls,
    grandTotal, prevGrandTotal, handlers.length, qhCount, agentRows, shiftAnalysis, leaveDist,
  ]);

  const closeRefineModal = (force = false) => {
    if (importProgress && !force) return;
    setIsRefineModalOpen(false);
    setRefinedRows([]);
    setRefineWarnings([]);
    setRefineSourceName('');
    setImportProgress(null);
    if (analyticsFileInputRef.current) analyticsFileInputRef.current.value = '';
  };

  const refineAnalyticsRowsFromSheet = (rows: unknown[][], sheetName: string, fallbackYear: number) => {
    const warnings: string[] = [];
    const refined: RefinedAnalyticsRow[] = [];

    if (!rows.length) return { refined, warnings };

    const sheetDate = parseDateFromSheetName(sheetName, fallbackYear);

    const scanLimit = Math.min(rows.length, 30);
    let headerIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < scanLimit; i++) {
      const headers = (rows[i] ?? []).map((c) => normalizeCellValue(c).toLowerCase());
      const hasName = findColumnIndex(headers, ['agent', 'handler', 'employee', 'name']) > -1;
      const hasDate = findColumnIndex(headers, ['date', 'day']) > -1 || !!sheetDate;
      const hasInc = findColumnIndex(headers, ['incident', 'inc']) > -1;
      const hasTask = findColumnIndex(headers, ['sctask', 'sc task', 'request', 'task']) > -1;
      const hasCall = findColumnIndex(headers, ['call']) > -1;
      const score = [hasName, hasDate, hasInc, hasTask, hasCall].filter(Boolean).length;
      if (score > bestScore) {
        bestScore = score;
        headerIdx = i;
      }
    }

    const hasHeader = headerIdx > -1 && bestScore >= 2;

    if (hasHeader) {
      const header = (rows[headerIdx] ?? []).map((c) => normalizeCellValue(c).toLowerCase());
      const nameCol = findColumnIndex(header, ['agent', 'handler', 'employee', 'name']);
      const dateCol = findColumnIndex(header, ['date', 'day']);
      const incCol = findColumnIndex(header, ['incident', 'inc']);
      const taskCol = findColumnIndex(header, ['sctask', 'sc task', 'request', 'task']);
      const callCol = findColumnIndex(header, ['call']);
      const shiftCol = findColumnIndex(header, ['shift']);
      const shiftTimingCol = findColumnIndex(header, ['shift timing', 'timing']);
      const p1Col = findColumnIndex(header, ['p1/p2/vip', 'p1', 'vip']);
      const commentsCol = findColumnIndex(header, ['comment']);
      const totalHandledCol = findColumnIndex(header, ['total handled', 'total']);
      const endorsementCol = findColumnIndex(header, ['endorsement']);
      const grandTotalCol = findColumnIndex(header, ['grand total', 'grant total']);

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] ?? [];
        if (row.every((c) => normalizeCellValue(c) === '')) continue;

        const name = nameCol > -1 ? normalizeCellValue(row[nameCol]) : '';
        const date = dateCol > -1 ? (parseExcelDate(row[dateCol]) ?? sheetDate) : sheetDate;
        const shift = shiftCol > -1 ? normalizeCellValue(row[shiftCol]) : '';
        if (!name || !date) {
          warnings.push(`${sheetName} row ${i + 1}: skipped (missing name/date)`);
          continue;
        }

        if (/[+]/.test(name) || /assistance/i.test(name)) {
          warnings.push(`${sheetName} row ${i + 1}: skipped queue-pair/non-employee row`);
          continue;
        }

        const incidents = incCol > -1 ? parseNumberCell(row[incCol]) : 0;
        const sctasks = taskCol > -1 ? parseNumberCell(row[taskCol]) : 0;
        const calls = callCol > -1 ? parseNumberCell(row[callCol]) : 0;
        const totalHandled = totalHandledCol > -1
          ? parseNumberCell(row[totalHandledCol])
          : incidents + sctasks + calls;
        const endorsementTickets = endorsementCol > -1 ? parseNumberCell(row[endorsementCol]) : 0;
        const grandTotal = grandTotalCol > -1 ? parseNumberCell(row[grandTotalCol]) : totalHandled + endorsementTickets;

        if (!incidents && !sctasks && !calls && !totalHandled && /leave|weekoff|wo|pl|ml|el|ul/i.test(shift)) {
          warnings.push(`${sheetName} row ${i + 1}: skipped leave-only row`);
          continue;
        }

        const notes: string[] = [];
        if (dateCol < 0 && sheetDate) notes.push('Date inferred from sheet name');
        if (callCol < 0) notes.push('Calls missing in source');

        refined.push({
          agentName: name,
          date,
          shift,
          shiftTiming: shiftTimingCol > -1 ? normalizeCellValue(row[shiftTimingCol]) : '',
          incidents,
          sctasks,
          calls,
          p1p2vip: p1Col > -1 ? parseNumberCell(row[p1Col]) : 0,
          comments: commentsCol > -1 ? normalizeCellValue(row[commentsCol]) : '',
          totalHandled,
          endorsementTickets,
          grandTotal,
          sourceSheet: sheetName,
          sourceRow: i + 1,
          importStatus: 'Ready',
          dataQualityNotes: notes.join('; '),
        });
      }
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] ?? [];
        if (row.every((c) => normalizeCellValue(c) === '')) continue;

        const dateCell = row.find((c) => parseExcelDate(c));
        const date = (dateCell ? parseExcelDate(dateCell) : null) ?? sheetDate;
        const nameCell = row.find((c) => isLikelyNameText(c));
        const name = nameCell ? normalizeCellValue(nameCell) : '';
        const nums = row.map((c) => parseNumberCell(c)).filter((n) => Number.isFinite(n) && n > 0);

        if (!name || !date) {
          warnings.push(`${sheetName} row ${i + 1}: skipped (unable to infer name/date)`);
          continue;
        }

        if (/[+]/.test(name) || /assistance/i.test(name)) {
          warnings.push(`${sheetName} row ${i + 1}: skipped queue-pair/non-employee row`);
          continue;
        }

        const incidents = nums[0] ?? 0;
        const sctasks = nums[1] ?? 0;
        const calls = nums[2] ?? 0;
        const totalHandled = incidents + sctasks + calls;

        refined.push({
          agentName: name,
          date,
          shift: '',
          shiftTiming: '',
          incidents,
          sctasks,
          calls,
          p1p2vip: 0,
          comments: '',
          totalHandled,
          endorsementTickets: 0,
          grandTotal: totalHandled,
          sourceSheet: sheetName,
          sourceRow: i + 1,
          importStatus: 'Ready',
          dataQualityNotes: 'Inferred from unstructured row',
        });
      }
    }

    return { refined, warnings };
  };

  const handleAnalyticsFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRefiningAnalytics(true);
    setRefinedRows([]);
    setRefineWarnings([]);
    setRefineSourceName(file.name);

    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      if (!wb.SheetNames.length) {
        setImportStatus({ message: 'No sheets found in uploaded file.', tone: 'warning' });
        return;
      }

      const inferredYearFromName = file.name.match(/(20\d{2})/)?.[1];
      const fallbackYear = inferredYearFromName ? Number(inferredYearFromName) : new Date().getFullYear();
      const workbookWarnings: string[] = [];
      const workbookRefined: RefinedAnalyticsRow[] = [];

      wb.SheetNames.forEach((sheetName) => {
        const ws = wb.Sheets[sheetName];
        if (!ws) return;
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        if (!rawRows.length) return;

        const { refined, warnings } = refineAnalyticsRowsFromSheet(rawRows, sheetName, fallbackYear);
        workbookRefined.push(...refined);
        workbookWarnings.push(...warnings);
      });

      // De-duplicate by employee + date while summing metrics, which is safer
      // for workbooks containing repeated or corrected sheets for the same date.
      const dedup = new Map<string, RefinedAnalyticsRow>();
      workbookRefined.forEach((row) => {
        const key = `${row.date}__${row.agentName.toLowerCase()}`;
        const existing = dedup.get(key);
        if (!existing) {
          dedup.set(key, row);
          return;
        }
        dedup.set(key, {
          ...existing,
          incidents: existing.incidents + row.incidents,
          sctasks: existing.sctasks + row.sctasks,
          calls: existing.calls + row.calls,
          p1p2vip: existing.p1p2vip + row.p1p2vip,
          totalHandled: existing.totalHandled + row.totalHandled,
          endorsementTickets: existing.endorsementTickets + row.endorsementTickets,
          grandTotal: existing.grandTotal + row.grandTotal,
          dataQualityNotes: [existing.dataQualityNotes, 'Merged duplicate employee/date rows'].filter(Boolean).join('; '),
        });
      });

      const refined = Array.from(dedup.values()).sort((a, b) =>
        a.date.localeCompare(b.date) || a.agentName.localeCompare(b.agentName)
      );
      const warnings = workbookWarnings;

      if (!refined.length) {
        setImportStatus({ message: 'Unable to refine file into import-ready analytics rows.', tone: 'warning' });
        return;
      }

      setRefinedRows(refined);
      setRefineWarnings(warnings);
    } catch (err) {
      setImportStatus({
        message: `Refine failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        tone: 'warning',
      });
    } finally {
      setIsRefiningAnalytics(false);
    }
  };

  const downloadRefinedCopy = () => {
    if (!refinedRows.length) return;
    const wb = XLSX.utils.book_new();
    const rows = refinedRows.map((r) => ({
      'Date (YYYY-MM-DD)': r.date,
      'Employee Name': r.agentName,
      'Shift': r.shift,
      'Shift Timing': r.shiftTiming,
      'Incidents': r.incidents,
      'Requests / SCTASK': r.sctasks,
      'Calls': r.calls,
      'P1/P2/VIP': r.p1p2vip,
      'Additional Comments': r.comments,
      'Total Handled': r.totalHandled,
      'Endorsement Tickets': r.endorsementTickets,
      'Grand Total': r.grandTotal,
      'Source Sheet': r.sourceSheet,
      'Source Row': r.sourceRow,
      'Import Status': r.importStatus,
      'Data Quality Notes': r.dataQualityNotes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Import Ready');
    const baseName = refineSourceName ? refineSourceName.replace(/\.[^/.]+$/, '') : 'analytics';
    XLSX.writeFile(wb, `${baseName}-import-ready.xlsx`);
  };

  const importRefinedRows = async () => {
    if (!refinedRows.length) return;
    setImportStatus(null);
    setIsImportingAnalytics(true);
    setImportProgress({ step: 'Preparing analytics rows...', percent: 10, mode: 'import' });
    try {
      const lookup = new Map<string, string>();
      handlers.forEach((h) => lookup.set(h.name.trim().toLowerCase(), h.id));

      const parsedStats: DailyStats[] = [];
      const newHandlers: Handler[] = [];

      refinedRows.forEach((row) => {
        const key = row.agentName.toLowerCase();
        let hid = lookup.get(key);
        if (!hid) {
          hid = createAgentId();
          lookup.set(key, hid);
          newHandlers.push({ id: hid, name: row.agentName, isQH: false });
        }
        parsedStats.push({
          handlerId: hid,
          date: row.date,
          incidents: row.incidents,
          sctasks: row.sctasks,
          calls: row.calls,
          comments: '',
        });
      });

      const ackErrors: string[] = [];
      const withAck = (label: string, fn: (cb: (res: { ok: boolean; error?: string }) => void) => void) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            ackErrors.push(`${label}: server confirmation timed out`);
            resolve();
          }, SERVER_ACK_TIMEOUT_MS);
          fn((res) => {
            clearTimeout(timer);
            if (!res?.ok) ackErrors.push(`${label}: ${res?.error || 'failed'}`);
            resolve();
          });
        });

      const mergedStats = mergeStatsEntries(stats, parsedStats);
      setStats(mergedStats);
      localStorage.setItem('stats', JSON.stringify(mergedStats));
      setImportProgress({ step: 'Syncing analytics stats to server...', percent: 45, mode: 'import' });
      await withAck('Stats', (cb) => syncData.updateStats(mergedStats, cb));

      if (newHandlers.length) {
        const mergedHandlers = [...handlers, ...newHandlers];
        setHandlers(mergedHandlers);
        localStorage.setItem('handlers', JSON.stringify(mergedHandlers));
        setImportProgress({ step: 'Syncing newly discovered handlers...', percent: 75, mode: 'import' });
        await withAck('Handlers', (cb) => syncData.updateHandlers(mergedHandlers, cb));
      }

      const onlyTimeoutErrors = ackErrors.length > 0 && ackErrors.every((e) => e.toLowerCase().includes('timed out'));
      let effectiveAckErrors = [...ackErrors];
      let verificationMsg = '';

      if (onlyTimeoutErrors) {
        setImportProgress({ step: 'Ack timed out. Verifying backend save status...', percent: 90, mode: 'import' });
        const verified = await verifyImportedStatsOnServer(parsedStats);
        if (verified.ok) {
          effectiveAckErrors = [];
          verificationMsg = ` Verified on backend (${verified.detail}).`;
        } else {
          verificationMsg = ` Still unconfirmed (${verified.detail}).`;
        }
      }

      const tone: ImportFeedback['tone'] = effectiveAckErrors.length ? 'warning' : 'success';
      const savedMsg = effectiveAckErrors.length
        ? (onlyTimeoutErrors
            ? ` Server confirmation pending/timed out — ${effectiveAckErrors.join('; ')}.${verificationMsg}`
            : ` Server save failed — ${effectiveAckErrors.join('; ')}`)
        : ' Saved to server.';
      const refineNote = refineWarnings.length ? ` ${refineWarnings.length} row(s) were skipped during refining.` : '';
      setImportStatus({
        message: `Imported ${parsedStats.length} analytics row(s).${newHandlers.length ? ` +${newHandlers.length} new agent(s).` : ''}${refineNote}${savedMsg}`,
        tone,
      });
      setImportProgress({ step: 'Import completed.', percent: 100, mode: 'import' });
      closeRefineModal(true);
    } catch (err) {
      setImportStatus({
        message: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        tone: 'warning',
      });
      setImportProgress({ step: 'Import failed.', percent: 100, mode: 'import' });
    } finally {
      setIsImportingAnalytics(false);
      setTimeout(() => setImportProgress(null), 1200);
    }
  };

  const importAndDownloadRefined = async () => {
    setImportProgress({ step: 'Generating refined download file...', percent: 8, mode: 'both' });
    downloadRefinedCopy();
    setImportProgress({ step: 'Download generated. Starting import...', percent: 18, mode: 'both' });
    await importRefinedRows();
  };

  if (role && role!=='admin') return (
    <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:16,opacity:0.35}}>
      <Shield size={48} strokeWidth={1} color="#94a3b8"/>
      <div style={{fontSize:13,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.3em'}}>Admin Access Required</div>
    </div>
  );

  const TABS: {id:TabId;label:string;icon:React.ReactNode}[] = [
    {id:'overview', label:'Overview',       icon:<BarChart2 size={13}/>},
    {id:'agents',   label:'All Agents',     icon:<Users size={13}/>},
    {id:'qh',       label:'Queue Handlers', icon:<Shield size={13}/>},
    {id:'shifts',   label:'Shift Analysis', icon:<Activity size={13}/>},
    {id:'leave',    label:'Leave Report',   icon:<Calendar size={13}/>},
  ];

  const RANK_C = ['#0f172a','#475569','#64748b'];

  const TH: React.FC<{label:string;col?:string;align?:string}> = ({label,col,align='center'}) => (
    <th onClick={col?()=>toggleSort(col):undefined} style={{
      padding:'7px 10px',fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',
      letterSpacing:'0.15em',textAlign:align as any,borderBottom:'2px solid #e2e8f0',
      cursor:col?'pointer':'default',userSelect:'none',background:'#f8fafc',whiteSpace:'nowrap',
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:align==='left'?'flex-start':'center',gap:4}}>
        {label}{col&&<SortIcon col={col} active={sortCol} dir={sortDir}/>}
      </div>
    </th>
  );

  const AgentRow: React.FC<{r:typeof agentRows[0];rank?:number;medals?:boolean}> = ({r,rank,medals}) => (
    <tr style={{background:'#fff',transition:'background 0.08s'}}
      onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
      onMouseLeave={e=>e.currentTarget.style.background='#fff'}
    >
      {rank!==undefined && (
        <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}>
          <span style={{fontSize:11,fontWeight:medals&&rank<3?900:700,color:medals&&rank<3?RANK_C[rank]:'#94a3b8',fontVariantNumeric:'tabular-nums'}}>
            {rank+1}
          </span>
        </td>
      )}
      <td style={{padding:'6px 10px',borderBottom:'1px solid #f1f5f9'}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <div style={{width:24,height:24,borderRadius:'50%',background:r.isQH?'#fef3c7':'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:900,color:r.isQH?'#92400e':'#64748b',flexShrink:0}}>
            {r.name.split(' ').map((p:string)=>p[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:'#0f172a',whiteSpace:'nowrap'}}>{r.name}</div>
            <div style={{display:'flex',gap:4,marginTop:1}}>
              {r.isQH    && <Badge label="QH"       color="#92400e" bg="#fef3c7" border="#fde68a"/>}
              {r.onLeave && <Badge label="On Leave" color="#991b1b" bg="#fee2e2" border="#fca5a5"/>}
            </div>
          </div>
        </div>
      </td>
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:12,fontWeight:900,color:INC_C, fontVariantNumeric:'tabular-nums'}}>{r.inc}</span></td>
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:12,fontWeight:900,color:TASK_C,fontVariantNumeric:'tabular-nums'}}>{r.task}</span></td>
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:12,fontWeight:900,color:CALL_C,fontVariantNumeric:'tabular-nums'}}>{r.calls}</span></td>
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:13,fontWeight:900,color:'#0f172a',fontVariantNumeric:'tabular-nums'}}>{r.total}</span></td>
      {mode!=='day'&&<td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:11,fontWeight:700,color:'#64748b'}}>{r.days}</span></td>}
      {mode!=='day'&&<td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:11,fontWeight:700,color:'#475569'}}>{r.perDay}</span></td>}
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}>
        <div style={{width:'100%',maxWidth:80,margin:'0 auto'}}>
          <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct(r.total,topPerformers[0]?.total||1)}%`,background:'#0f172a',borderRadius:2}}/>
          </div>
        </div>
      </td>
      <td style={{padding:'6px 10px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}>
        {r.shift!=='—'
          ? <Badge label={r.shift} color={SHIFT_COLORS[r.shift]||'#475569'} bg={`${SHIFT_COLORS[r.shift]||'#475569'}18`} border={`${SHIFT_COLORS[r.shift]||'#475569'}40`}/>
          : <span style={{fontSize:9,color:'#cbd5e1',fontWeight:600}}>—</span>
        }
      </td>
    </tr>
  );

  const TableHeaders: React.FC<{showRank?:boolean}> = ({showRank}) => (
    <thead>
      <tr>
        {showRank&&<TH label="#"/>}
        <TH label="Agent" col="name" align="left"/>
        <TH label="INC"   col="inc"/>
        <TH label="Tasks" col="task"/>
        <TH label="Calls" col="calls"/>
        <TH label="Total" col="total"/>
        {mode!=='day'&&<TH label="Days" col="days"/>}
        {mode!=='day'&&<TH label="Avg/Day" col="perDay"/>}
        <TH label="Bar"/>
        <TH label="Shift" col="shift"/>
      </tr>
    </thead>
  );

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column',overflow:'hidden',background:'#f1f5f9',fontFamily:'system-ui,sans-serif'}}>

      {/* ══ TOPBAR ══════════════════════════════════════════════════════════ */}
      <div style={{flexShrink:0,background:'#fff',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',height:46}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:28,height:28,background:'#0f172a',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center'}}><BarChart2 size={14} color="white"/></div>
            <div style={{lineHeight:1}}>
              <div style={{fontSize:7,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Admin</div>
              <div style={{fontSize:12,color:'#0f172a',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.1em'}}>Overview</div>
            </div>
          </div>
          <div style={{width:1,height:24,background:'#e2e8f0'}}/>
          <div style={{display:'flex',background:'#f1f5f9',borderRadius:8,padding:3,border:'1px solid #e2e8f0',gap:2}}>
            {(['day','month','year'] as FilterMode[]).map(m=>(
              <button key={m} onClick={()=>setMode(m)} style={{padding:'3px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:10,fontWeight:900,textTransform:'uppercase',letterSpacing:'0.12em',transition:'all 0.15s',background:mode===m?'#0f172a':'transparent',color:mode===m?'#fff':'#64748b'}}>
                {m}
              </button>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={()=>navPeriod(-1)} style={{width:24,height:24,border:'1px solid #e2e8f0',borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><ChevronLeft size={12} color="#64748b"/></button>
            <div style={{padding:'3px 12px',background:'#fff',border:'1px solid #cbd5e1',borderRadius:6,fontSize:11,fontWeight:800,color:'#0f172a',minWidth:180,textAlign:'center',whiteSpace:'nowrap'}}>
              {periodLabel}
              {mode==='day'&&selectedDay===today&&<span style={{marginLeft:6,fontSize:8,fontWeight:900,color:'#2563eb',background:'#dbeafe',borderRadius:4,padding:'1px 5px'}}>TODAY</span>}
            </div>
            <button onClick={()=>navPeriod(1)} style={{width:24,height:24,border:'1px solid #e2e8f0',borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><ChevronRight size={12} color="#64748b"/></button>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{display:'flex',border:'1px solid #cbd5e1',borderRadius:6,overflow:'hidden'}}>
            {[{l:'INC',v:totalInc,c:'#2563eb',bg:'#dbeafe'},{l:'TASK',v:totalTask,c:'#b45309',bg:'#fef9c3'},{l:'CALLS',v:totalCalls,c:'#00ADB5',bg:'#f0fdfa'},{l:'TOTAL',v:grandTotal,c:'#0f172a',bg:'#f1f5f9'}].map((t,i)=>(
              <div key={t.l} style={{padding:'3px 12px',textAlign:'center',borderLeft:i?'1px solid #e2e8f0':'none',background:t.bg,minWidth:56}}>
                <div style={{fontSize:7,color:t.c,fontWeight:900,textTransform:'uppercase',letterSpacing:'0.12em'}}>{t.l}</div>
                <div style={{fontSize:15,fontWeight:900,color:t.c,fontVariantNumeric:'tabular-nums'}}>{t.v}</div>
              </div>
            ))}
          </div>
          <button onClick={exportReport} style={{display:'flex',alignItems:'center',gap:6,height:32,padding:'0 12px',border:'1px solid #cbd5e1',borderRadius:6,background:'#fff',cursor:'pointer',fontSize:11,fontWeight:700,color:'#0f172a'}}>
            <Download size={12}/> Export
          </button>
          {!actions.importRoster ? (
            <div title="Access Restricted" style={{display:'flex',alignItems:'center',gap:6,height:32,padding:'0 12px',border:'1px solid #fecaca',borderRadius:6,background:'#fff1f2',fontSize:11,fontWeight:700,color:'#be123c',opacity:0.6,cursor:'not-allowed'}}>
              <Lock size={12}/> Import Analytics
            </div>
          ) : (
            <button
              onClick={() => setIsRefineModalOpen(true)}
              disabled={isImportingAnalytics}
              style={{display:'flex',alignItems:'center',gap:6,height:32,padding:'0 12px',border:'1px solid #cbd5e1',borderRadius:6,background:'#fff',cursor:'pointer',fontSize:11,fontWeight:700,color:'#0f172a',opacity:isImportingAnalytics?0.6:1}}
            >
              <Upload size={12}/> {isImportingAnalytics ? 'Importing…' : 'Refine + Import Analytics'}
            </button>
          )}
          <input ref={analyticsFileInputRef} type="file" onChange={handleAnalyticsFileChange} accept=".xlsx,.xls,.csv" className="hidden" />
        </div>
      </div>

      {importStatus && (
        <div style={{flexShrink:0,padding:'8px 16px 0'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'8px 10px',borderRadius:8,border:`1px solid ${importStatus.tone==='success' ? '#bbf7d0' : importStatus.tone==='warning' ? '#fde68a' : '#fecaca'}`,background:importStatus.tone==='success' ? '#f0fdf4' : importStatus.tone==='warning' ? '#fffbeb' : '#fef2f2',color:importStatus.tone==='success' ? '#166534' : importStatus.tone==='warning' ? '#92400e' : '#991b1b',fontSize:11,fontWeight:700}}>
            <span>{importStatus.message}</span>
            <button onClick={() => setImportStatus(null)} style={{border:'none',background:'transparent',cursor:'pointer',color:'inherit',opacity:0.65,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <X size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* ══ SIDEBAR + CONTENT ═══════════════════════════════════════════════ */}
      <div style={{flex:1,minHeight:0,display:'flex',overflow:'hidden'}}>

        {/* Sidebar */}
        <div style={{width:160,flexShrink:0,background:'#fff',borderRight:'1px solid #e2e8f0',display:'flex',flexDirection:'column',padding:'10px 8px',gap:2}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:8,border:'none',
              cursor:'pointer',fontSize:11,fontWeight:700,textAlign:'left',transition:'all 0.12s',
              background:activeTab===t.id?'#0f172a':'transparent',
              color:activeTab===t.id?'#fff':'#64748b',
            }}
              onMouseEnter={e=>{if(activeTab!==t.id)(e.currentTarget.style.background='#f1f5f9');}}
              onMouseLeave={e=>{if(activeTab!==t.id)(e.currentTarget.style.background='transparent');}}
            >
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
          <div style={{marginTop:'auto',borderTop:'1px solid #e2e8f0',paddingTop:10,display:'flex',flexDirection:'column',gap:5}}>
            {[{l:'Agents',v:handlers.length,c:'#0f172a'},{l:'Active',v:activeCount,c:'#16a34a'},{l:'On Leave',v:leaveCount,c:'#dc2626'},{l:'QH',v:qhCount,c:'#b45309'}].map(s=>(
              <div key={s.l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'2px 4px'}}>
                <span style={{fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.12em'}}>{s.l}</span>
                <span style={{fontSize:14,fontWeight:900,color:s.c,fontVariantNumeric:'tabular-nums'}}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,minHeight:0,overflow:'auto',padding:12,display:'flex',flexDirection:'column',gap:10}}>

          {/* ── OVERVIEW ───────────────────────────────────────────────────── */}
          {activeTab==='overview' && (<>
            <div style={{fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>
              vs previous {mode}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:10,flexShrink:0}}>
              <KpiCard label="Active Agents"   value={activeCount}      sub="on shift"        color="#0f172a" trend={pctChange(activeCount, prevActiveCount)}/>
              <KpiCard label="Attendance"      value={`${attendanceRate}%`} sub="scheduled days worked" color="#0d9488" trend={pctChange(attendanceRate, prevAttendanceRate)}/>
              <KpiCard label="Incidents"       value={totalInc}         sub="logged"          color="#2563eb" trend={pctChange(totalInc, prevTotalInc)}/>
              <KpiCard label="SC Tasks"        value={totalTask}        sub="completed"       color="#b45309" trend={pctChange(totalTask, prevTotalTask)}/>
              <KpiCard label="Calls"           value={totalCalls}       sub="handled"         color="#00ADB5" trend={pctChange(totalCalls, prevTotalCalls)}/>
              <KpiCard label="Avg / Agent"     value={activeCount?+(grandTotal/activeCount).toFixed(1):0} sub="tickets+calls" color="#7c3aed"/>
              <KpiCard label="Total Agents"    value={handlers.length}  sub="registered"      color="#475569"/>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 260px',gap:10,flex:1,minHeight:200}}>
              <Card>
                <CardHead sup={mode==='day'?'Per Agent':mode==='month'?'Daily':'Monthly'} title="Productivity Volume"
                  right={<div style={{display:'flex',gap:10}}><LegendDot color={INC_C} label="INC"/><LegendDot color={TASK_C} label="TASK"/><LegendDot color={CALL_C} label="CALLS"/></div>}/>
                <div style={{flex:1,minHeight:0,padding:'8px 4px 6px'}}>
                  {barData.length===0?<Empty/>:(
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{top:4,right:8,left:-22,bottom:0}} barCategoryGap="28%">
                        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="label" tick={{fontSize:9,fontWeight:700,fill:'#64748b'}} tickLine={false} axisLine={false}/>
                        <YAxis tick={{fontSize:8,fill:'#94a3b8'}} tickLine={false} axisLine={false}/>
                        <Tooltip content={<TT/>}/>
                        <Bar dataKey="INC"   stackId="a" fill={INC_C}  name="Incidents" radius={[0,0,0,0]}/>
                        <Bar dataKey="TASK"  stackId="a" fill={TASK_C} name="SC Tasks"  radius={[0,0,0,0]}/>
                        <Bar dataKey="CALLS" stackId="a" fill={CALL_C} name="Calls"     radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
              <Card>
                <CardHead sup="Distribution" title="Shift Coverage"/>
                <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
                  {shiftDist.length===0?<Empty msg="No roster"/>:(<>
                    <div style={{flex:1,minHeight:0}}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={shiftDist} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius="42%" outerRadius="68%" paddingAngle={2}>
                            {shiftDist.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                          </Pie>
                          <Tooltip content={<PieTT/>}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{flexShrink:0,padding:'0 12px 10px',display:'flex',flexWrap:'wrap',gap:'3px 8px'}}>
                      {shiftDist.map((e,i)=>(
                        <div key={i} style={{display:'flex',alignItems:'center',gap:3,fontSize:8,fontWeight:700,color:'#374151'}}>
                          <div style={{width:6,height:6,borderRadius:2,background:e.fill,flexShrink:0}}/>{e.name} ({e.value})
                        </div>
                      ))}
                    </div>
                  </>)}
                </div>
              </Card>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 240px 240px',gap:10,flex:1,minHeight:180}}>
              <Card>
                <CardHead sup="Trend" title="Activity Over Time"
                  right={<div style={{display:'flex',gap:10}}><LegendDot color={INC_C} label="INC" type="line"/><LegendDot color={CALL_C} label="CALLS" type="line"/></div>}/>
                <div style={{flex:1,minHeight:0,padding:'8px 4px 6px'}}>
                  {barData.length<2?<Empty msg="Need 2+ data points"/>:(
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={barData} margin={{top:4,right:8,left:-22,bottom:0}}>
                        <defs>
                          <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={INC_C}  stopOpacity={0.2}/><stop offset="95%" stopColor={INC_C}  stopOpacity={0}/></linearGradient>
                          <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CALL_C} stopOpacity={0.2}/><stop offset="95%" stopColor={CALL_C} stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="label" tick={{fontSize:9,fontWeight:700,fill:'#64748b'}} tickLine={false} axisLine={false}/>
                        <YAxis tick={{fontSize:8,fill:'#94a3b8'}} tickLine={false} axisLine={false}/>
                        <Tooltip content={<TT/>}/>
                        <Area type="monotone" dataKey="INC"   stroke={INC_C}  strokeWidth={2} fill="url(#gI)" name="Incidents" dot={{r:2,fill:INC_C, stroke:'#fff',strokeWidth:1}}/>
                        <Area type="monotone" dataKey="CALLS" stroke={CALL_C} strokeWidth={2} fill="url(#gC)" name="Calls"     dot={{r:2,fill:CALL_C,stroke:'#fff',strokeWidth:1}}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
              <Card>
                <CardHead sup="Rankings · Avg / Day Worked" title="Top Performers"/>
                <div style={{flex:1,overflow:'hidden',padding:'8px 14px 10px',display:'flex',flexDirection:'column',gap:6}}>
                  {topPerformers.length===0?<Empty msg="No data"/>:topPerformers.map((r,i)=>(
                    <div key={r.id}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:2}}>
                        <div style={{display:'flex',alignItems:'center',gap:7}}>
                          <span style={{fontSize:11,fontWeight:900,color:i<3?RANK_C[i]:'#94a3b8',width:12,fontVariantNumeric:'tabular-nums'}}>{i+1}</span>
                          <span style={{fontSize:11,fontWeight:700,color:'#0f172a',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</span>
                        </div>
                        <span style={{fontSize:12,fontWeight:900,color:'#0f172a',fontVariantNumeric:'tabular-nums'}}>{r.perDay}<span style={{fontSize:9,fontWeight:700,color:'#94a3b8'}}>/day</span></span>
                      </div>
                      <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden'}}>
                        <div style={{width:`${pct(r.perDay,topPerformers[0].perDay)}%`,height:'100%',background:i<3?RANK_C[i]:'#cbd5e1',borderRadius:2}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHead sup="Absences" title="Leave Breakdown"/>
                <div style={{flex:1,overflow:'hidden',padding:'8px 14px 10px',display:'flex',flexDirection:'column',gap:5}}>
                  {leaveDist.length===0?<Empty msg="No leaves"/>:leaveDist.map(({label,value,color})=>{
                    const max=leaveDist[0].value;
                    return (
                      <div key={label}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                          <span style={{fontSize:9,fontWeight:700,color:'#374151',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
                          <span style={{fontSize:10,fontWeight:900,color,fontVariantNumeric:'tabular-nums'}}>{value}</span>
                        </div>
                        <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden'}}>
                          <div style={{width:`${pct(value,max)}%`,height:'100%',background:color,borderRadius:2}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </>)}

          {/* ── AGENTS ─────────────────────────────────────────────────────── */}
          {activeTab==='agents' && (
            <Card style={{flex:1,minHeight:0}}>
              <div style={{flexShrink:0,padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid #e2e8f0'}}>
                <div>
                  <div style={{fontSize:8,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Full Roster</div>
                  <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>All Agents — {agentRows.length}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:7}}>
                    <Search size={11} color="#94a3b8"/>
                    <input value={agentSearch} onChange={e=>setAgentSearch(e.target.value)} placeholder="Search…"
                      style={{border:'none',background:'transparent',fontSize:11,color:'#374151',outline:'none',width:110}}/>
                  </div>
                  {[{l:'INC',v:totalInc,c:INC_C},{l:'TASK',v:totalTask,c:TASK_C},{l:'CALLS',v:totalCalls,c:CALL_C}].map(x=>(
                    <div key={x.l} style={{padding:'3px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6,textAlign:'center'}}>
                      <div style={{fontSize:7,fontWeight:900,color:x.c,textTransform:'uppercase',letterSpacing:'0.15em'}}>{x.l}</div>
                      <div style={{fontSize:14,fontWeight:900,color:x.c,fontVariantNumeric:'tabular-nums'}}>{x.v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{flex:1,minHeight:0,overflow:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <TableHeaders/>
                  <tbody>
                    {agentRows.length===0
                      ? <tr><td colSpan={10} style={{padding:40,textAlign:'center',color:'#94a3b8',fontSize:12,fontWeight:700}}>No agents found</td></tr>
                      : agentRows.map((r,i)=><AgentRow key={r.id} r={r} rank={i}/>)
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── QH ─────────────────────────────────────────────────────────── */}
          {activeTab==='qh' && (<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,flexShrink:0}}>
              <KpiCard label="Queue Handlers" value={qhCount}                          sub="designated"   color="#b45309"/>
              <KpiCard label="QH Incidents"   value={qhRows.reduce((a,r)=>a+r.inc,0)} sub="logged"       color="#2563eb"/>
              <KpiCard label="QH Tasks"       value={qhRows.reduce((a,r)=>a+r.task,0)}sub="completed"    color="#b45309"/>
              <KpiCard label="QH Calls"       value={qhRows.reduce((a,r)=>a+r.calls,0)}sub="handled"     color="#00ADB5"/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,flex:1,minHeight:200}}>
              <Card style={{flex:1,minHeight:0}}>
                <CardHead sup="Queue Handler Detail" title={`QH Performance — ${qhRows.length}`}/>
                <div style={{flex:1,minHeight:0,overflow:'auto',marginTop:8}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <TableHeaders showRank/>
                    <tbody>
                      {qhRows.length===0
                        ? <tr><td colSpan={10} style={{padding:32,textAlign:'center',color:'#94a3b8',fontSize:12,fontWeight:700}}>No QH data for this period</td></tr>
                        : qhRows.map((r,i)=><AgentRow key={r.id} r={r} rank={i} medals/>)
                      }
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card>
                <CardHead sup="Comparison" title="QH vs Standard"
                  right={<div style={{display:'flex',gap:8}}><LegendDot color="#f59e0b" label="QH"/><LegendDot color="#3b82f6" label="Standard"/></div>}/>
                <div style={{flex:1,minHeight:0,padding:'8px 4px 6px'}}>
                  {(()=>{
                    const data=[
                      {label:'Incidents',QH:qhRows.reduce((a,r)=>a+r.inc,0),  Standard:stdRows.reduce((a,r)=>a+r.inc,0)},
                      {label:'SC Tasks', QH:qhRows.reduce((a,r)=>a+r.task,0), Standard:stdRows.reduce((a,r)=>a+r.task,0)},
                      {label:'Calls',    QH:qhRows.reduce((a,r)=>a+r.calls,0),Standard:stdRows.reduce((a,r)=>a+r.calls,0)},
                    ];
                    if(!data.some(d=>d.QH+d.Standard>0)) return <Empty msg="No data to compare"/>;
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{top:4,right:8,left:-22,bottom:0}} barCategoryGap="35%">
                          <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#f1f5f9"/>
                          <XAxis dataKey="label" tick={{fontSize:10,fontWeight:700,fill:'#64748b'}} tickLine={false} axisLine={false}/>
                          <YAxis tick={{fontSize:8,fill:'#94a3b8'}} tickLine={false} axisLine={false}/>
                          <Tooltip content={<TT/>}/>
                          <Bar dataKey="QH"       fill="#f59e0b" name="QH"       radius={[3,3,0,0]}/>
                          <Bar dataKey="Standard" fill="#3b82f6" name="Standard" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>
              </Card>
            </div>
            <Card style={{flex:1,minHeight:0}}>
              <CardHead sup="Standard Agents" title={`Non-QH — ${stdRows.length} agents`}/>
              <div style={{flex:1,minHeight:0,overflow:'auto',marginTop:8}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <TableHeaders showRank/>
                  <tbody>
                    {stdRows.length===0
                      ? <tr><td colSpan={10} style={{padding:24,textAlign:'center',color:'#94a3b8',fontSize:12,fontWeight:700}}>No standard agent data</td></tr>
                      : stdRows.map((r,i)=><AgentRow key={r.id} r={r} rank={i}/>)
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          </>)}

          {/* ── SHIFT ANALYSIS ─────────────────────────────────────────────── */}
          {activeTab==='shifts' && (<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,flexShrink:0}}>
              {shiftAnalysis.map(s=>{
                const c=SHIFT_COLORS[s.shift]||'#475569';
                return (
                  <div key={s.shift} style={{background:'#fff',border:`1px solid ${c}30`,borderRadius:12,padding:'12px 14px',boxShadow:'0 1px 3px rgba(0,0,0,0.05)',borderTop:`3px solid ${c}`}}>
                    <div style={{fontSize:8,fontWeight:900,color:c,textTransform:'uppercase',letterSpacing:'0.15em',marginBottom:4}}>{s.shift}</div>
                    <div style={{fontSize:22,fontWeight:900,color:'#0f172a',fontVariantNumeric:'tabular-nums',lineHeight:1}}>{s.total}</div>
                    <div style={{fontSize:9,color:'#94a3b8',fontWeight:600,marginTop:3}}>{s.agents} agents</div>
                    <div style={{display:'flex',gap:8,marginTop:6}}>
                      {[{l:'I',v:s.inc,c:INC_C},{l:'T',v:s.task,c:TASK_C},{l:'C',v:s.calls,c:CALL_C}].map(x=>(
                        <div key={x.l} style={{flex:1,textAlign:'center'}}>
                          <div style={{fontSize:7,fontWeight:900,color:x.c,textTransform:'uppercase'}}>{x.l}</div>
                          <div style={{fontSize:13,fontWeight:900,color:x.c,fontVariantNumeric:'tabular-nums'}}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,flex:1,minHeight:200}}>
              <Card>
                <CardHead sup="Shift Comparison" title="Volume by Shift"
                  right={<div style={{display:'flex',gap:8}}><LegendDot color={INC_C} label="INC"/><LegendDot color={TASK_C} label="TASK"/><LegendDot color={CALL_C} label="CALLS"/></div>}/>
                <div style={{flex:1,minHeight:0,padding:'8px 4px 6px'}}>
                  {shiftAnalysis.every(s=>s.total===0)?<Empty/>:(
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={shiftAnalysis.map(s=>({label:s.shift,INC:s.inc,TASK:s.task,CALLS:s.calls}))} margin={{top:4,right:8,left:-22,bottom:0}} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="label" tick={{fontSize:8,fontWeight:700,fill:'#64748b'}} tickLine={false} axisLine={false}/>
                        <YAxis tick={{fontSize:8,fill:'#94a3b8'}} tickLine={false} axisLine={false}/>
                        <Tooltip content={<TT/>}/>
                        <Bar dataKey="INC"   fill={INC_C}  name="Incidents" radius={[0,0,0,0]}/>
                        <Bar dataKey="TASK"  fill={TASK_C} name="SC Tasks"  radius={[0,0,0,0]}/>
                        <Bar dataKey="CALLS" fill={CALL_C} name="Calls"     radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
              <Card>
                <CardHead sup="Coverage" title="Agents per Shift"/>
                <div style={{flex:1,minHeight:0,padding:'8px 4px 6px'}}>
                  {shiftDist.length===0?<Empty msg="No roster"/>:(
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={shiftDist.map(s=>({label:s.name,Agents:s.value}))} layout="vertical" margin={{top:4,right:32,left:60,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#f1f5f9"/>
                        <XAxis type="number" tick={{fontSize:8,fill:'#94a3b8'}} tickLine={false} axisLine={false}/>
                        <YAxis type="category" dataKey="label" tick={{fontSize:9,fontWeight:700,fill:'#374151'}} tickLine={false} axisLine={false} width={55}/>
                        <Tooltip content={<TT/>}/>
                        <Bar dataKey="Agents" fill="#0f172a" radius={[0,4,4,0]} label={{position:'right',fontSize:10,fontWeight:900,fill:'#374151'}}/>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
            </div>
            <Card style={{flexShrink:0}}>
              <CardHead sup="Detail" title="Shift Breakdown Table"/>
              <div style={{overflow:'auto',marginTop:8}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr>
                      {['Shift','Agents','Incidents','SC Tasks','Calls','Total','Avg/Agent'].map((h,i)=>(
                        <th key={h} style={{padding:'7px 12px',fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.15em',textAlign:i===0?'left':'center',borderBottom:'2px solid #e2e8f0',background:'#f8fafc',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shiftAnalysis.map(s=>{
                      const c=SHIFT_COLORS[s.shift]||'#475569';
                      return (
                        <tr key={s.shift} style={{background:'#fff'}}
                          onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                          onMouseLeave={e=>e.currentTarget.style.background='#fff'}
                        >
                          <td style={{padding:'8px 12px',borderBottom:'1px solid #f1f5f9'}}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <div style={{width:8,height:8,borderRadius:2,background:c,flexShrink:0}}/>
                              <span style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{s.shift}</span>
                            </div>
                          </td>
                          {[s.agents,s.inc,s.task,s.calls,s.total].map((v,i)=>(
                            <td key={i} style={{padding:'8px 12px',textAlign:'center',borderBottom:'1px solid #f1f5f9',fontSize:12,fontWeight:700,fontVariantNumeric:'tabular-nums',
                              color:i===4?'#0f172a':i===1?INC_C:i===2?TASK_C:i===3?CALL_C:'#374151'}}>{v}</td>
                          ))}
                          <td style={{padding:'8px 12px',textAlign:'center',borderBottom:'1px solid #f1f5f9',fontSize:12,fontWeight:700,color:'#475569'}}>{s.agents>0?+(s.total/s.agents).toFixed(1):0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>)}

          {/* ── LEAVE REPORT ───────────────────────────────────────────────── */}
          {activeTab==='leave' && (<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,flexShrink:0}}>
              <KpiCard label="Total on Leave"  value={leaveCount}                                              sub="in period"  color="#dc2626"/>
              <KpiCard label="WeekOff"         value={filteredRoster.filter(r=>r.shift==='WeekOff').length}        sub="entries"    color="#64748b"/>
              <KpiCard label="Medical Leave"   value={filteredRoster.filter(r=>r.shift==='Medical Leave').length}  sub="entries"    color="#831843"/>
              <KpiCard label="Planned Leave"   value={filteredRoster.filter(r=>r.shift==='Planned Leave').length}  sub="entries"    color="#78350f"/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 260px',gap:10,flex:1,minHeight:200}}>
              <Card style={{flex:1,minHeight:0}}>
                <CardHead sup="Leave Detail" title="Agent Leave Records"/>
                <div style={{flex:1,minHeight:0,overflow:'auto',marginTop:8}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr>
                        {['Agent','Leave Type','Date','QH'].map((h,i)=>(
                          <th key={h} style={{padding:'7px 12px',fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.15em',textAlign:i===0?'left':'center',borderBottom:'2px solid #e2e8f0',background:'#f8fafc'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRoster.filter(r=>LEAVE_TYPES.has(r.shift)).length===0
                        ? <tr><td colSpan={4} style={{padding:32,textAlign:'center',color:'#94a3b8',fontSize:12,fontWeight:700}}>No leave records</td></tr>
                        : filteredRoster.filter(r=>LEAVE_TYPES.has(r.shift)).sort((a,b)=>a.date.localeCompare(b.date)).map((r,i)=>{
                          const h=handlerMap.get(r.handlerId);
                          const lc=LEAVE_COLORS[i%LEAVE_COLORS.length];
                          return (
                            <tr key={i} style={{background:'#fff'}}
                              onMouseEnter={e=>e.currentTarget.style.background='#fef2f2'}
                              onMouseLeave={e=>e.currentTarget.style.background='#fff'}
                            >
                              <td style={{padding:'7px 12px',borderBottom:'1px solid #f1f5f9'}}>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                  <div style={{width:22,height:22,borderRadius:'50%',background:'#fee2e2',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:900,color:'#dc2626',flexShrink:0}}>
                                    {h?.name.split(' ').map((p:string)=>p[0]).join('').slice(0,2).toUpperCase()||'?'}
                                  </div>
                                  <span style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>{h?.name||r.handlerId}</span>
                                </div>
                              </td>
                              <td style={{padding:'7px 12px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}>
                                <Badge label={r.shift} color={lc} bg={`${lc}15`} border={`${lc}35`}/>
                              </td>
                              <td style={{padding:'7px 12px',textAlign:'center',borderBottom:'1px solid #f1f5f9',fontSize:11,fontWeight:700,color:'#64748b',fontVariantNumeric:'tabular-nums'}}>{r.date}</td>
                              <td style={{padding:'7px 12px',textAlign:'center',borderBottom:'1px solid #f1f5f9'}}>
                                {h?.isQH?<Badge label="QH" color="#92400e" bg="#fef3c7" border="#fde68a"/>:<span style={{fontSize:9,color:'#cbd5e1'}}>—</span>}
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card>
                <CardHead sup="Breakdown" title="By Leave Type"/>
                <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
                  {leaveDist.length===0?<Empty msg="No leaves"/>:(<>
                    <div style={{flex:1,minHeight:0}}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={leaveDist.map(l=>({...l,fill:l.color}))} dataKey="value" nameKey="label" cx="50%" cy="48%" innerRadius="40%" outerRadius="65%" paddingAngle={2}>
                            {leaveDist.map((e,i)=><Cell key={i} fill={e.color}/>)}
                          </Pie>
                          <Tooltip content={<PieTT/>}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{flexShrink:0,padding:'0 12px 10px',display:'flex',flexWrap:'wrap',gap:'3px 8px'}}>
                      {leaveDist.map((e,i)=>(
                        <div key={i} style={{display:'flex',alignItems:'center',gap:3,fontSize:8,fontWeight:700,color:'#374151'}}>
                          <div style={{width:6,height:6,borderRadius:2,background:e.color,flexShrink:0}}/>{e.label} ({e.value})
                        </div>
                      ))}
                    </div>
                  </>)}
                </div>
              </Card>
            </div>
          </>)}

        </div>
      </div>

      {isRefineModalOpen && (
        <div style={{position:'fixed',inset:0,zIndex:70,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{position:'absolute',inset:0,background:'rgba(15,23,42,0.35)'}} onClick={closeRefineModal} />
          <div style={{position:'relative',width:'min(900px,95vw)',maxHeight:'90vh',overflow:'hidden',background:'#fff',border:'1px solid #e2e8f0',borderRadius:12,display:'flex',flexDirection:'column'}}>
            <div style={{padding:'12px 14px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.16em'}}>Analytics Refiner</div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Unstructured to Import Ready</div>
              </div>
              <button onClick={closeRefineModal} style={{border:'none',background:'transparent',cursor:'pointer',color:'#64748b',display:'flex',alignItems:'center'}}>
                <X size={16}/>
              </button>
            </div>

            <div style={{padding:14,display:'flex',flexDirection:'column',gap:10,overflow:'auto'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                <button
                  onClick={() => analyticsFileInputRef.current?.click()}
                  disabled={isRefiningAnalytics}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',cursor:'pointer',fontSize:11,fontWeight:800,color:'#0f172a',opacity:isRefiningAnalytics?0.6:1}}
                >
                  <Upload size={13}/> {isRefiningAnalytics ? 'Refining…' : 'Choose Unstructured File'}
                </button>
                <span style={{fontSize:10,fontWeight:700,color:'#64748b'}}>
                  {refineSourceName ? `Source: ${refineSourceName}` : 'Upload your raw analytics workbook'}
                </span>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>
                <div style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,background:'#f8fafc'}}>
                  <div style={{fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.14em'}}>Ready Rows</div>
                  <div style={{fontSize:18,fontWeight:900,color:'#0f172a',marginTop:2}}>{refinedRows.length}</div>
                </div>
                <div style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,background:'#f8fafc'}}>
                  <div style={{fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.14em'}}>Warnings</div>
                  <div style={{fontSize:18,fontWeight:900,color:'#b45309',marginTop:2}}>{refineWarnings.length}</div>
                </div>
                <div style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:8,background:'#f8fafc'}}>
                  <div style={{fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.14em'}}>Status</div>
                  <div style={{fontSize:11,fontWeight:900,color:isRefiningAnalytics ? '#2563eb' : refinedRows.length ? '#166534' : '#64748b',marginTop:6}}>
                    {isRefiningAnalytics ? 'Refining workbook…' : refinedRows.length ? 'Ready for action' : 'Waiting for file'}
                  </div>
                </div>
              </div>

              {importProgress && (
                <div style={{border:'1px solid #bfdbfe',background:'#eff6ff',borderRadius:8,padding:'8px 10px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:6}}>
                    <span style={{fontSize:9,fontWeight:900,color:'#1d4ed8',textTransform:'uppercase',letterSpacing:'0.12em'}}>
                      {importProgress.mode === 'both' ? 'Download + Import Progress' : 'Import Progress'}
                    </span>
                    <span style={{fontSize:11,fontWeight:900,color:'#1e3a8a'}}>{importProgress.percent}%</span>
                  </div>
                  <div style={{height:8,background:'#dbeafe',borderRadius:999,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.max(0, Math.min(100, importProgress.percent))}%`,background:'#2563eb',transition:'width 220ms ease'}} />
                  </div>
                  <div style={{fontSize:11,fontWeight:700,color:'#1e40af',marginTop:6}}>{importProgress.step}</div>
                </div>
              )}

              {refineWarnings.length > 0 && (
                <div style={{border:'1px solid #fde68a',background:'#fffbeb',borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:9,fontWeight:900,color:'#92400e',textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:4}}>Refine Notes (first 12)</div>
                  <ul style={{margin:0,paddingLeft:16,maxHeight:110,overflow:'auto'}}>
                    {refineWarnings.slice(0, 12).map((w, idx) => (
                      <li key={idx} style={{fontSize:10,color:'#92400e',lineHeight:1.4}}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
                <div style={{padding:'6px 10px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',fontSize:9,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.12em'}}>Refined Preview</div>
                <div style={{maxHeight:260,overflow:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr>
                        {['Date','Employee Name','Incidents','Requests / SCTASK','Calls','Source Sheet'].map((h) => (
                          <th key={h} style={{padding:'6px 8px',fontSize:8,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.12em',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {refinedRows.slice(0, 50).map((r, idx) => (
                        <tr key={`${r.date}-${r.agentName}-${idx}`}>
                          <td style={{padding:'6px 8px',fontSize:11,color:'#0f172a',borderBottom:'1px solid #f1f5f9'}}>{r.date}</td>
                          <td style={{padding:'6px 8px',fontSize:11,color:'#0f172a',borderBottom:'1px solid #f1f5f9'}}>{r.agentName}</td>
                          <td style={{padding:'6px 8px',fontSize:11,color:'#2563eb',borderBottom:'1px solid #f1f5f9'}}>{r.incidents}</td>
                          <td style={{padding:'6px 8px',fontSize:11,color:'#b45309',borderBottom:'1px solid #f1f5f9'}}>{r.sctasks}</td>
                          <td style={{padding:'6px 8px',fontSize:11,color:'#0f766e',borderBottom:'1px solid #f1f5f9'}}>{r.calls}</td>
                          <td style={{padding:'6px 8px',fontSize:10,color:'#64748b',borderBottom:'1px solid #f1f5f9'}}>{r.sourceSheet}</td>
                        </tr>
                      ))}
                      {!refinedRows.length && !isRefiningAnalytics && (
                        <tr>
                          <td colSpan={6} style={{padding:16,textAlign:'center',fontSize:11,color:'#94a3b8'}}>No refined rows yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{padding:'10px 14px',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
              <button onClick={closeRefineModal} style={{border:'none',background:'transparent',cursor:'pointer',fontSize:11,fontWeight:800,color:'#64748b'}}>Cancel</button>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button
                  onClick={downloadRefinedCopy}
                  disabled={!refinedRows.length || isImportingAnalytics || isRefiningAnalytics}
                  style={{padding:'7px 12px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',cursor:'pointer',fontSize:11,fontWeight:800,color:'#0f172a',opacity:(!refinedRows.length || isImportingAnalytics || isRefiningAnalytics) ? 0.5 : 1}}
                >
                  Download Refined Copy
                </button>
                <button
                  onClick={importRefinedRows}
                  disabled={!refinedRows.length || isImportingAnalytics || isRefiningAnalytics}
                  style={{padding:'7px 12px',border:'1px solid #cbd5e1',borderRadius:8,background:'#0f172a',cursor:'pointer',fontSize:11,fontWeight:800,color:'#fff',opacity:(!refinedRows.length || isImportingAnalytics || isRefiningAnalytics) ? 0.5 : 1}}
                >
                  Import Now
                </button>
                <button
                  onClick={importAndDownloadRefined}
                  disabled={!refinedRows.length || isImportingAnalytics || isRefiningAnalytics}
                  style={{padding:'7px 12px',border:'1px solid #0369a1',borderRadius:8,background:'#0284c7',cursor:'pointer',fontSize:11,fontWeight:800,color:'#fff',opacity:(!refinedRows.length || isImportingAnalytics || isRefiningAnalytics) ? 0.5 : 1}}
                >
                  Download + Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;

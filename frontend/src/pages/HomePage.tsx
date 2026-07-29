import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRole } from '../auth/RoleContext';
import type { Handler, RosterEntry, DailyStats } from '../types';
import { TrendingUp } from 'lucide-react';
import { Users } from 'lucide-react';
import { PhoneCall } from 'lucide-react';
import { FileText } from 'lucide-react';
import { Activity } from 'lucide-react';
import { ChevronLeft } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { BarChart2 } from 'lucide-react';
import { Award } from 'lucide-react';

// ── amCharts 5 — sequential script loader ────────────────────────────────────
const AM_SCRIPTS = [
  'https://cdn.amcharts.com/lib/5/index.js',
  'https://cdn.amcharts.com/lib/5/xy.js',
  'https://cdn.amcharts.com/lib/5/percent.js',
  'https://cdn.amcharts.com/lib/5/themes/Animated.js',
];

function loadAmCharts(): Promise<void> {
  return new Promise((resolve) => {
    // All already loaded
    if ((window as any).am5 && (window as any).am5xy && (window as any).am5percent && (window as any).am5themes_Animated) {
      resolve(); return;
    }
    const missing = AM_SCRIPTS.filter(src => !document.querySelector(`script[src="${src}"]`));
    if (missing.length === 0) {
      // Scripts in DOM but maybe not ready yet — poll
      const poll = setInterval(() => {
        if ((window as any).am5 && (window as any).am5xy && (window as any).am5percent && (window as any).am5themes_Animated) {
          clearInterval(poll); resolve();
        }
      }, 50);
      return;
    }
    let idx = 0;
    const next = () => {
      if (idx >= missing.length) {
        resolve(); return;
      }
      const s = document.createElement('script');
      s.src = missing[idx++];
      s.onload = next;
      s.onerror = next; // skip on error, chart will just not render
      document.head.appendChild(s);
    };
    next();
  });
}

// ── Chart container ───────────────────────────────────────────────────────────
const AmChart: React.FC<{
  id: string;
  makeChart: (am5: any, am5xy: any, am5pct: any, am5th: any, root: any) => void;
  data: any[];
  style?: React.CSSProperties;
}> = ({ id, makeChart, data, style }) => {
  const mountedRef = useRef(false);
  const disposeRef = useRef<(() => void) | null>(null);
  const dataRef    = useRef(data);
  dataRef.current  = data;

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;

    loadAmCharts().then(() => {
      if (!mountedRef.current || disposed) return;
      const el = document.getElementById(id);
      if (!el) return;

      // Dispose old root if any
      if (disposeRef.current) { try { disposeRef.current(); } catch {} disposeRef.current = null; }

      const am5   = (window as any).am5;
      const am5xy = (window as any).am5xy;
      const am5pct= (window as any).am5percent;
      const am5th = (window as any).am5themes_Animated;
      if (!am5 || !am5xy || !am5pct || !am5th) return;

      try {
        const root = am5.Root.new(id);
        disposeRef.current = () => { try { root.dispose(); } catch {} };
        makeChart(am5, am5xy, am5pct, am5th, root);
      } catch (e) {
        console.warn('amChart init error:', e);
      }
    });

    return () => {
      disposed = true;
      mountedRef.current = false;
      if (disposeRef.current) { try { disposeRef.current(); } catch {} disposeRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, data.length > 0, JSON.stringify(data.slice(0,3))]);

  return <div id={id} style={{ width: '100%', height: '100%', ...style }} />;
};

// ── Types ─────────────────────────────────────────────────────────────────────
type FilterMode = 'day' | 'month' | 'year';
const LEAVE_TYPES = new Set(['WeekOff','Medical Leave','Planned Leave','Earned Leave','Unplanned Leave','Complimentary Off','MID-LEAVE']);
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const dayStr  = (d: Date) => d.toLocaleDateString('en-CA');
const monthOf = (d: string) => d.slice(0, 7);
const yearOf  = (d: string) => d.slice(0, 4);

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  label: string; value: number | string; sub?: string;
  Icon: React.FC<{size?:number;color?:string}>;
  color: string; bg: string; border: string;
}> = ({ label, value, sub, Icon, color, bg, border }) => (
  <div style={{ background:'#fff', border:`1px solid ${border}`, borderRadius:12, padding:'14px 18px', display:'flex', flexDirection:'column', gap:8, boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
      <span style={{ fontSize:9, fontWeight:900, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em' }}>{label}</span>
      <div style={{ width:30, height:30, borderRadius:8, background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Icon size={14} color={color} />
      </div>
    </div>
    <span style={{ fontSize:28, fontWeight:900, color:'#0f172a', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{value}</span>
    {sub && <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{sub}</span>}
  </div>
);

// ── Chart placeholder ─────────────────────────────────────────────────────────
const NoData: React.FC<{ msg?: string }> = ({ msg = 'No data for this period' }) => (
  <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, opacity:0.25 }}>
    <BarChart2 size={28} strokeWidth={1} color="#94a3b8" />
    <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.15em' }}>{msg}</span>
  </div>
);

// ── Chart colours ─────────────────────────────────────────────────────────────
const INC_C   = '#3b82f6';
const TASK_C  = '#f59e0b';
const CALL_C  = '#00ADB5';
const SHIFT_PALETTE = ['#3b82f6','#f59e0b','#f97316','#ef4444','#8b5cf6','#10b981','#ec4899'];

// ══════════════════════════════════════════════════════════════════════════════
const HomePage: React.FC = () => {
  const { role } = useRole();
  const [mode, setMode] = useState<FilterMode>('day');

  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const [selectedDay,   setSelectedDay]   = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0,7));
  const [selectedYear,  setSelectedYear]  = useState(today.slice(0,4));

  // ── Load data from localStorage — poll every 3s so it stays fresh ──────────
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [roster,   setRoster]   = useState<RosterEntry[]>([]);
  const [stats,    setStats]    = useState<DailyStats[]>([]);

  useEffect(() => {
    const load = () => {
      try { const h = JSON.parse(localStorage.getItem('handlers') || '[]'); if (h.length) setHandlers(h); } catch {}
      try { const r = JSON.parse(localStorage.getItem('roster')   || '[]'); if (r.length) setRoster(r);   } catch {}
      try { const s = JSON.parse(localStorage.getItem('stats')    || '[]'); if (s.length) setStats(s);    } catch {}
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  // ── Handler lookup map — keyed by id for O(1) lookup ─────────────────────
  const handlerMap = useMemo(() => {
    const m = new Map<string, string>();
    handlers.forEach(h => m.set(h.id, h.name));
    return m;
  }, [handlers]);

  // ── Period-filtered stats ─────────────────────────────────────────────────
  const filteredStats = useMemo(() => {
    if (mode === 'day')   return stats.filter(s => s.date === selectedDay);
    if (mode === 'month') return stats.filter(s => monthOf(s.date) === selectedMonth);
    return stats.filter(s => yearOf(s.date) === selectedYear);
  }, [stats, mode, selectedDay, selectedMonth, selectedYear]);

  const totalInc   = filteredStats.reduce((a,s) => a + Number(s.incidents||0), 0);
  const totalTask  = filteredStats.reduce((a,s) => a + Number(s.sctasks  ||0), 0);
  const totalCalls = filteredStats.reduce((a,s) => a + Number(s.calls    ||0), 0);
  const grandTotal = totalInc + totalTask + totalCalls;

  // ── Active handler count — unique handlers with non-leave shift in period ──
  const activeHandlerCount = useMemo(() => {
    if (mode === 'day') {
      return new Set(
        roster.filter(r => r.date === selectedDay && !LEAVE_TYPES.has(r.shift)).map(r => r.handlerId)
      ).size;
    }
    const entries = roster.filter(r => {
      const inPeriod = mode === 'month' ? monthOf(r.date) === selectedMonth : yearOf(r.date) === selectedYear;
      return inPeriod && !LEAVE_TYPES.has(r.shift);
    });
    return new Set(entries.map(r => r.handlerId)).size;
  }, [roster, mode, selectedDay, selectedMonth, selectedYear]);

  // ── Top performers ────────────────────────────────────────────────────────
  const topPerformers = useMemo(() => {
    const map: Record<string,number> = {};
    filteredStats.forEach(s => {
      const t = Number(s.incidents||0) + Number(s.sctasks||0) + Number(s.calls||0);
      if (t > 0) map[s.handlerId] = (map[s.handlerId]||0) + t;
    });
    return Object.entries(map)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([id,total]) => ({ name: handlerMap.get(id) || `ID:${id.slice(0,6)}`, total }));
  }, [filteredStats, handlerMap]);

  // ── Bar chart data ────────────────────────────────────────────────────────
  const barData = useMemo(() => {
    if (mode === 'day') {
      // Per agent for the selected day
      return filteredStats
        .map(s => ({
          label: (handlerMap.get(s.handlerId) || '').split(' ')[0] || `?${s.handlerId.slice(0,4)}`,
          inc:   Number(s.incidents||0),
          task:  Number(s.sctasks  ||0),
          calls: Number(s.calls    ||0),
        }))
        .filter(d => d.inc + d.task + d.calls > 0)
        .sort((a,b) => (b.inc+b.task+b.calls)-(a.inc+a.task+a.calls))
        .slice(0, 15);
    }
    if (mode === 'month') {
      const days: Record<string,{inc:number;task:number;calls:number}> = {};
      stats.filter(s => monthOf(s.date) === selectedMonth).forEach(s => {
        if (!days[s.date]) days[s.date] = {inc:0,task:0,calls:0};
        days[s.date].inc   += Number(s.incidents||0);
        days[s.date].task  += Number(s.sctasks  ||0);
        days[s.date].calls += Number(s.calls    ||0);
      });
      return Object.entries(days)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([date,v]) => ({ label: date.slice(8), ...v }));  // day number only
    }
    // Year — per month
    const months: Record<string,{inc:number;task:number;calls:number}> = {};
    stats.filter(s => yearOf(s.date) === selectedYear).forEach(s => {
      const mk = monthOf(s.date);
      if (!months[mk]) months[mk] = {inc:0,task:0,calls:0};
      months[mk].inc   += Number(s.incidents||0);
      months[mk].task  += Number(s.sctasks  ||0);
      months[mk].calls += Number(s.calls    ||0);
    });
    return Object.entries(months)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([m,v]) => ({ label: MONTH_NAMES[parseInt(m.slice(5))-1], ...v }));
  }, [filteredStats, stats, handlerMap, mode, selectedMonth, selectedYear]);

  // ── Shift distribution ────────────────────────────────────────────────────
  const shiftDist = useMemo(() => {
    const map: Record<string,number> = {};
    roster.filter(r => {
      if (!LEAVE_TYPES.has(r.shift)) {
        if (mode === 'day')   return r.date === selectedDay;
        if (mode === 'month') return monthOf(r.date) === selectedMonth;
        return yearOf(r.date) === selectedYear;
      }
      return false;
    }).forEach(r => { map[r.shift] = (map[r.shift]||0)+1; });
    return Object.entries(map).map(([shift,value]) => ({ shift, value }));
  }, [roster, mode, selectedDay, selectedMonth, selectedYear]);

  // ── Leave breakdown ───────────────────────────────────────────────────────
  const leaveDist = useMemo(() => {
    const map: Record<string,number> = {};
    roster.filter(r => {
      if (!LEAVE_TYPES.has(r.shift)) return false;
      if (mode === 'day')   return r.date === selectedDay;
      if (mode === 'month') return monthOf(r.date) === selectedMonth;
      return yearOf(r.date) === selectedYear;
    }).forEach(r => { map[r.shift] = (map[r.shift]||0)+1; });
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([label,value]) => ({ label, value }));
  }, [roster, mode, selectedDay, selectedMonth, selectedYear]);

  // ── Period navigation ─────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (mode === 'day') {
      return new Date(selectedDay+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    }
    if (mode === 'month') {
      const [y,m] = selectedMonth.split('-');
      return new Date(+y,+m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
    }
    return selectedYear;
  }, [mode, selectedDay, selectedMonth, selectedYear]);

  const navPeriod = (dir: number) => {
    if (mode === 'day') {
      const [y,m,d] = selectedDay.split('-').map(Number);
      const dt = new Date(y,m-1,d); dt.setDate(dt.getDate()+dir);
      setSelectedDay(dt.toLocaleDateString('en-CA'));
    } else if (mode === 'month') {
      const [y,m] = selectedMonth.split('-').map(Number);
      const dt = new Date(y,m-1+dir,1);
      setSelectedMonth(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`);
    } else {
      setSelectedYear(String(+selectedYear+dir));
    }
  };

  if (role && role !== 'admin') {
    return (
      <div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,opacity:0.4}}>
        <BarChart2 size={48} strokeWidth={1} color="#94a3b8"/>
        <div style={{fontSize:13,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.3em'}}>Admin Access Required</div>
      </div>
    );
  }

  const B = '1px solid #e2e8f0';

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column',overflow:'hidden',background:'#f8fafc',fontFamily:'system-ui,sans-serif'}}>

      {/* ══ TOPBAR ══════════════════════════════════════════════════════════ */}
      <div style={{flexShrink:0,height:46,background:'#fff',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',gap:12}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:28,height:28,background:'#0f172a',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <BarChart2 size={14} color="white"/>
            </div>
            <div style={{lineHeight:1}}>
              <div style={{fontSize:7,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Admin</div>
              <div style={{fontSize:12,color:'#0f172a',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.1em'}}>Analytics</div>
            </div>
          </div>
          <div style={{width:1,height:24,background:'#e2e8f0'}}/>

          {/* Mode selector */}
          <div style={{display:'flex',background:'#f1f5f9',borderRadius:8,padding:3,border:B,gap:2}}>
            {(['day','month','year'] as FilterMode[]).map(m=>(
              <button key={m} onClick={()=>setMode(m)} style={{padding:'4px 14px',borderRadius:6,border:'none',cursor:'pointer',fontSize:10,fontWeight:900,textTransform:'uppercase',letterSpacing:'0.12em',transition:'all 0.15s',background:mode===m?'#0f172a':'transparent',color:mode===m?'#fff':'#64748b'}}>
                {m}
              </button>
            ))}
          </div>

          {/* Period nav */}
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={()=>navPeriod(-1)} style={{width:26,height:26,border:B,borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <ChevronLeft size={13} color="#64748b"/>
            </button>
            <div style={{padding:'4px 14px',background:'#fff',border:'1px solid #cbd5e1',borderRadius:6,fontSize:11,fontWeight:800,color:'#0f172a',minWidth:200,textAlign:'center',whiteSpace:'nowrap'}}>
              {periodLabel}
              {mode==='day'&&selectedDay===today&&<span style={{marginLeft:8,fontSize:9,fontWeight:900,color:'#2563eb',background:'#dbeafe',borderRadius:4,padding:'1px 6px'}}>TODAY</span>}
            </div>
            <button onClick={()=>navPeriod(1)} style={{width:26,height:26,border:B,borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <ChevronRight size={13} color="#64748b"/>
            </button>
          </div>
        </div>

        {/* Right — totals */}
        <div style={{display:'flex',border:'1px solid #cbd5e1',borderRadius:6,overflow:'hidden',background:'#fff'}}>
          {[
            {l:'Incidents',v:totalInc,  c:'#2563eb',bg:'#dbeafe'},
            {l:'SC Tasks', v:totalTask, c:'#b45309',bg:'#fef9c3'},
            {l:'Calls',    v:totalCalls,c:'#00ADB5',bg:'#f0fdfa'},
            {l:'Total',    v:grandTotal,c:'#0f172a',bg:'#f1f5f9'},
          ].map((t,i)=>(
            <div key={t.l} style={{padding:'3px 14px',textAlign:'center',borderLeft:i?'1px solid #e2e8f0':'none',background:t.bg,minWidth:64}}>
              <div style={{fontSize:7,color:t.c,fontWeight:900,textTransform:'uppercase',letterSpacing:'0.15em'}}>{t.l}</div>
              <div style={{fontSize:16,fontWeight:900,color:t.c,fontVariantNumeric:'tabular-nums'}}>{t.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div style={{flex:1,minHeight:0,overflow:'hidden',padding:'10px 12px',display:'grid',gridTemplateRows:'auto 1fr 1fr',gap:10}}>

        {/* Row 1 — KPI cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
          <KpiCard label="Active Handlers" value={activeHandlerCount} sub={mode==='day'?'on shift today':'unique in period'} Icon={Users}      color="#0f172a" bg="#f1f5f9" border="#e2e8f0"/>
          <KpiCard label="Total Handlers"  value={handlers.length}   sub="registered"                                      Icon={Users}      color="#475569" bg="#f8fafc" border="#e2e8f0"/>
          <KpiCard label="Incidents"       value={totalInc}          sub="logged"                                          Icon={FileText}   color="#2563eb" bg="#dbeafe" border="#bfdbfe"/>
          <KpiCard label="SC Tasks"        value={totalTask}         sub="completed"                                       Icon={Activity}   color="#b45309" bg="#fef9c3" border="#fde68a"/>
          <KpiCard label="Calls"           value={totalCalls}        sub="handled"                                         Icon={PhoneCall}  color="#00ADB5" bg="#f0fdfa" border="#99f6e4"/>
          <KpiCard label="Avg per Agent"   value={activeHandlerCount?+(grandTotal/activeHandlerCount).toFixed(1):0} sub="tickets+calls" Icon={TrendingUp} color="#7c3aed" bg="#ede9fe" border="#c4b5fd"/>
        </div>

        {/* Row 2 — Stacked bar + Donut */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:10,minHeight:0}}>

          {/* Stacked bar */}
          <div style={{background:'#fff',borderRadius:12,border:B,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 16px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>
                  {mode==='day'?'Per Agent':mode==='month'?'Daily Breakdown':'Monthly Breakdown'}
                </div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Productivity Volume</div>
              </div>
              <div style={{display:'flex',gap:14,fontSize:9,fontWeight:700}}>
                {[{c:INC_C,l:'INC'},{c:TASK_C,l:'TASK'},{c:CALL_C,l:'CALLS'}].map(x=>(
                  <div key={x.l} style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:8,height:8,borderRadius:2,background:x.c}}/><span style={{color:'#64748b'}}>{x.l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{flex:1,minHeight:0,padding:'4px 8px 8px'}}>
              {barData.length === 0
                ? <NoData/>
                : <AmChart
                    id="chart-bar"
                    data={barData}
                    makeChart={(am5, am5xy, _pct, am5th, root) => {
                      root.setThemes([am5th.default.new(root)]);
                      const chart = root.container.children.push(am5xy.XYChart.new(root,{
                        panX:false, panY:false, wheelX:'none', wheelY:'none',
                      }));
                      chart.set('paddingLeft',0); chart.set('paddingRight',8); chart.set('paddingTop',4); chart.set('paddingBottom',0);

                      const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root,{
                        maxDeviation:0.1, categoryField:'label',
                        renderer: am5xy.AxisRendererX.new(root,{minGridDistance:20,cellStartLocation:0.1,cellEndLocation:0.9}),
                      }));
                      const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root,{
                        min:0, renderer:am5xy.AxisRendererY.new(root,{}),
                      }));
                      xAxis.get('renderer').labels.template.setAll({fontSize:10,fill:am5.color('#64748b'),fontWeight:'700'});
                      yAxis.get('renderer').labels.template.setAll({fontSize:9,fill:am5.color('#94a3b8')});
                      xAxis.get('renderer').grid.template.setAll({strokeOpacity:0});
                      yAxis.get('renderer').grid.template.setAll({stroke:am5.color('#e2e8f0'),strokeOpacity:1});

                      const mkSeries = (field:string, name:string, color:string) => {
                        const s = chart.series.push(am5xy.ColumnSeries.new(root,{
                          name, stacked:true, xAxis, yAxis,
                          valueYField:field, categoryXField:'label',
                          tooltip:am5.Tooltip.new(root,{labelText:'{name}: {valueY}'}),
                        }));
                        s.columns.template.setAll({fill:am5.color(color),stroke:am5.color(color),width:am5.percent(65)});
                        return s;
                      };
                      const s1=mkSeries('inc','Incidents',INC_C);
                      const s2=mkSeries('task','SC Tasks',TASK_C);
                      const s3=mkSeries('calls','Calls',CALL_C);
                      xAxis.data.setAll(barData);
                      s1.data.setAll(barData); s2.data.setAll(barData); s3.data.setAll(barData);
                      s1.appear(800); s2.appear(800); s3.appear(800); chart.appear(800,50);
                    }}
                  />
              }
            </div>
          </div>

          {/* Donut */}
          <div style={{background:'#fff',borderRadius:12,border:B,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 0'}}>
              <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Distribution</div>
              <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Shift Coverage</div>
            </div>
            <div style={{flex:1,minHeight:0}}>
              {shiftDist.length === 0
                ? <NoData msg="No roster data"/>
                : <AmChart
                    id="chart-donut"
                    data={shiftDist}
                    makeChart={(am5, _xy, am5pct, am5th, root) => {
                      root.setThemes([am5th.default.new(root)]);
                      const chart = root.container.children.push(am5pct.PieChart.new(root,{
                        layout:root.verticalLayout, innerRadius:am5.percent(55),
                        paddingTop:8, paddingBottom:8,
                      }));
                      const series = chart.series.push(am5pct.PieSeries.new(root,{
                        valueField:'value', categoryField:'shift', alignLabels:false,
                      }));
                      series.labels.template.setAll({fontSize:9,text:'{category}',radius:4,fill:am5.color('#374151'),fontWeight:'700'});
                      series.ticks.template.setAll({strokeOpacity:0.3});
                      series.slices.template.setAll({strokeWidth:2,stroke:am5.color('#fff'),cornerRadius:3});
                      series.set('colors', am5.ColorSet.new(root,{colors:SHIFT_PALETTE.map(c=>am5.color(c))}));
                      series.data.setAll(shiftDist);
                      series.appear(800); chart.appear(800,50);
                    }}
                  />
              }
            </div>
          </div>
        </div>

        {/* Row 3 — Leave + Line + Top performers */}
        <div style={{display:'grid',gridTemplateColumns:'220px 1fr 260px',gap:10,minHeight:0}}>

          {/* Leave breakdown */}
          <div style={{background:'#fff',borderRadius:12,border:B,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 6px'}}>
              <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Absences</div>
              <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Leave Breakdown</div>
            </div>
            <div style={{flex:1,minHeight:0,overflow:'hidden',padding:'0 14px 10px',display:'flex',flexDirection:'column',gap:6}}>
              {leaveDist.length === 0
                ? <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',opacity:0.25}}><span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>No leaves</span></div>
                : leaveDist.map(({label,value},i) => {
                  const max = leaveDist[0].value;
                  const pct = max>0?(value/max)*100:0;
                  const cols = ['#ef4444','#f97316','#f59e0b','#8b5cf6','#10b981','#3b82f6','#ec4899'];
                  const c = cols[i%cols.length];
                  return (
                    <div key={label} style={{flexShrink:0}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                        <span style={{fontSize:10,fontWeight:700,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150}}>{label}</span>
                        <span style={{fontSize:11,fontWeight:900,color:c,fontVariantNumeric:'tabular-nums'}}>{value}</span>
                      </div>
                      <div style={{height:5,background:'#f1f5f9',borderRadius:3,overflow:'hidden'}}>
                        <div style={{width:`${pct}%`,height:'100%',background:c,borderRadius:3,transition:'width 0.6s ease'}}/>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>

          {/* Line trend */}
          <div style={{background:'#fff',borderRadius:12,border:B,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 16px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Trend</div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Activity Over Time</div>
              </div>
              <div style={{display:'flex',gap:14,fontSize:9,fontWeight:700}}>
                {[{c:INC_C,l:'INC'},{c:CALL_C,l:'CALLS'}].map(x=>(
                  <div key={x.l} style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:14,height:2,borderRadius:1,background:x.c}}/><span style={{color:'#64748b'}}>{x.l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{flex:1,minHeight:0,padding:'4px 8px 8px'}}>
              {barData.length < 2
                ? <NoData msg="Need 2+ data points"/>
                : <AmChart
                    id="chart-line"
                    data={barData}
                    makeChart={(am5, am5xy, _pct, am5th, root) => {
                      root.setThemes([am5th.default.new(root)]);
                      const chart = root.container.children.push(am5xy.XYChart.new(root,{
                        panX:true, panY:false, wheelX:'panX', wheelY:'zoomX',
                        cursor:am5xy.XYCursor.new(root,{behavior:'none'}),
                      }));
                      chart.set('paddingLeft',0); chart.set('paddingRight',8); chart.set('paddingTop',4); chart.set('paddingBottom',0);

                      const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root,{
                        maxDeviation:0.2, categoryField:'label',
                        renderer:am5xy.AxisRendererX.new(root,{minGridDistance:30}),
                      }));
                      const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root,{
                        min:0, renderer:am5xy.AxisRendererY.new(root,{}),
                      }));
                      xAxis.get('renderer').labels.template.setAll({fontSize:10,fill:am5.color('#64748b'),fontWeight:'700'});
                      yAxis.get('renderer').labels.template.setAll({fontSize:9,fill:am5.color('#94a3b8')});
                      yAxis.get('renderer').grid.template.setAll({stroke:am5.color('#e2e8f0'),strokeOpacity:1});
                      xAxis.get('renderer').grid.template.setAll({strokeOpacity:0});

                      const mkLine = (field:string, name:string, color:string) => {
                        const s = chart.series.push(am5xy.SmoothedXLineSeries.new(root,{
                          name, xAxis, yAxis, valueYField:field, categoryXField:'label',
                          tooltip:am5.Tooltip.new(root,{labelText:'{name}: {valueY}'}),
                        }));
                        s.set('stroke', am5.color(color));
                        s.set('fill',   am5.color(color));
                        s.strokes.template.setAll({strokeWidth:2});
                        const grad = am5.LinearGradient.new(root,{stops:[{color:am5.color(color),opacity:0.25},{color:am5.color(color),opacity:0.02}],rotation:90});
                        s.fills.template.setAll({fillGradient:grad,visible:true});
                        s.bullets.push(()=>am5.Bullet.new(root,{sprite:am5.Circle.new(root,{radius:3,fill:am5.color(color),stroke:am5.color('#fff'),strokeWidth:1.5})}));
                        return s;
                      };
                      const sl = mkLine('inc','Incidents',INC_C);
                      const sc = mkLine('calls','Calls',CALL_C);
                      xAxis.data.setAll(barData);
                      sl.data.setAll(barData); sc.data.setAll(barData);
                      sl.appear(800); sc.appear(800); chart.appear(800,50);
                    }}
                  />
              }
            </div>
          </div>

          {/* Top performers */}
          <div style={{background:'#fff',borderRadius:12,border:B,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 6px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Rankings</div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Top Performers</div>
              </div>
              <Award size={16} color="#f59e0b"/>
            </div>
            <div style={{flex:1,minHeight:0,overflow:'hidden',padding:'0 14px 10px',display:'flex',flexDirection:'column',gap:7}}>
              {topPerformers.length === 0
                ? <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',opacity:0.25}}><span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>No data</span></div>
                : topPerformers.map(({name,total},i) => {
                  const max = topPerformers[0].total;
                  const pct = max>0?(total/max)*100:0;
                  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
                  const cols   = ['#f59e0b','#94a3b8','#b45309','#64748b','#94a3b8'];
                  return (
                    <div key={name+i} style={{flexShrink:0}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:12}}>{medals[i]}</span>
                          <span style={{fontSize:11,fontWeight:700,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}}>{name}</span>
                        </div>
                        <span style={{fontSize:12,fontWeight:900,color:cols[i],fontVariantNumeric:'tabular-nums'}}>{total}</span>
                      </div>
                      <div style={{height:5,background:'#f1f5f9',borderRadius:3,overflow:'hidden'}}>
                        <div style={{width:`${pct}%`,height:'100%',background:cols[i],borderRadius:3,transition:'width 0.5s ease'}}/>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;

import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useRole } from '../auth/RoleContext';
import type { Handler, RosterEntry, DailyStats } from '../types';
import {
  TrendingUp, Users, PhoneCall, FileText, Activity,
  Calendar, ChevronLeft, ChevronRight, BarChart2, Award, Clock
} from 'lucide-react';

// ── amCharts 5 loader (CDN, no npm needed) ────────────────────────────────────
const AM_SCRIPTS = [
  'https://cdn.amcharts.com/lib/5/index.js',
  'https://cdn.amcharts.com/lib/5/xy.js',
  'https://cdn.amcharts.com/lib/5/percent.js',
  'https://cdn.amcharts.com/lib/5/themes/Animated.js',
];
let amLoaded = false;
let amLoading = false;
const amCallbacks: (() => void)[] = [];
function loadAmCharts(cb: () => void) {
  if (amLoaded) { cb(); return; }
  amCallbacks.push(cb);
  if (amLoading) return;
  amLoading = true;
  let idx = 0;
  const loadNext = () => {
    if (idx >= AM_SCRIPTS.length) { amLoaded = true; amCallbacks.forEach(f => f()); amCallbacks.length = 0; return; }
    const s = document.createElement('script'); s.src = AM_SCRIPTS[idx++]; s.onload = loadNext; document.head.appendChild(s);
  };
  loadNext();
}

// ── types ─────────────────────────────────────────────────────────────────────
type FilterMode = 'day' | 'month' | 'year';
const LEAVE_TYPES = new Set(['WeekOff','Medical Leave','Planned Leave','Earned Leave','Unplanned Leave','Complimentary Off','MID-LEAVE']);

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{ label: string; value: number | string; sub?: string; Icon: React.FC<{size?:number;color?:string}>; color: string; bg: string; border: string; trend?: number }> =
  ({ label, value, sub, Icon, color, bg, border, trend }) => (
  <div style={{ background:'#fff', border:`1px solid ${border}`, borderRadius:12, padding:'14px 18px', display:'flex', flexDirection:'column', gap:8, boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
      <span style={{ fontSize:9, fontWeight:900, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.2em' }}>{label}</span>
      <div style={{ width:30, height:30, borderRadius:8, background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Icon size={14} color={color} />
      </div>
    </div>
    <div style={{ display:'flex', alignItems:'flex-end', gap:8 }}>
      <span style={{ fontSize:28, fontWeight:900, color:'#0f172a', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{value}</span>
      {trend !== undefined && trend !== 0 && (
        <span style={{ fontSize:11, fontWeight:700, color: trend > 0 ? '#16a34a' : '#dc2626', marginBottom:2 }}>
          {trend > 0 ? '▲' : '▼'} {Math.abs(trend)}%
        </span>
      )}
    </div>
    {sub && <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{sub}</span>}
  </div>
);

// ── amChart wrapper ───────────────────────────────────────────────────────────
const AmChart: React.FC<{ id: string; setup: (am5: any) => () => void; deps: any[] }> =
  ({ id, setup, deps }) => {
  const disposeRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    let cancelled = false;
    loadAmCharts(() => {
      if (cancelled) return;
      const am5 = (window as any).am5;
      if (!am5) return;
      if (disposeRef.current) { disposeRef.current(); disposeRef.current = null; }
      try { disposeRef.current = setup(am5); } catch (e) { console.error('amChart error', e); }
    });
    return () => { cancelled = true; if (disposeRef.current) { disposeRef.current(); disposeRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div id={id} style={{ width:'100%', height:'100%' }} />;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const dayStr  = (d: Date) => d.toLocaleDateString('en-CA');
const monthOf = (d: string) => d.slice(0, 7);  // YYYY-MM
const yearOf  = (d: string) => d.slice(0, 4);  // YYYY

// ══════════════════════════════════════════════════════════════════════════════
const HomePage: React.FC = () => {
  const { role } = useRole();
  const [mode, setMode] = useState<FilterMode>('day');

  // Selected period navigation
  const today  = new Date().toLocaleDateString('en-CA');
  const [selectedDay,   setSelectedDay]   = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0,7));
  const [selectedYear,  setSelectedYear]  = useState(today.slice(0,4));

  // Raw data from localStorage (same source as TrackerPage)
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [roster,   setRoster]   = useState<RosterEntry[]>([]);
  const [stats,    setStats]    = useState<DailyStats[]>([]);

  useEffect(() => {
    const load = () => {
      try { setHandlers(JSON.parse(localStorage.getItem('handlers') || '[]')); } catch {}
      try { setRoster(JSON.parse(localStorage.getItem('roster')   || '[]')); } catch {}
      try { setStats(JSON.parse(localStorage.getItem('stats')     || '[]')); } catch {}
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // ── Filter stats to selected period ────────────────────────────────────────
  const filteredStats = useMemo(() => {
    if (mode === 'day')   return stats.filter(s => s.date === selectedDay);
    if (mode === 'month') return stats.filter(s => monthOf(s.date) === selectedMonth);
    return stats.filter(s => yearOf(s.date) === selectedYear);
  }, [stats, mode, selectedDay, selectedMonth, selectedYear]);

  const totalInc   = filteredStats.reduce((a,s) => a + Number(s.incidents||0), 0);
  const totalTask  = filteredStats.reduce((a,s) => a + Number(s.sctasks  ||0), 0);
  const totalCalls = filteredStats.reduce((a,s) => a + Number(s.calls    ||0), 0);
  const grandTotal = totalInc + totalTask + totalCalls;

  // Active handlers for period
  const activeDates = useMemo(() => {
    if (mode === 'day')   return new Set([selectedDay]);
    if (mode === 'month') return new Set(roster.filter(r => monthOf(r.date) === selectedMonth && !LEAVE_TYPES.has(r.shift)).map(r => r.date));
    return new Set(roster.filter(r => yearOf(r.date) === selectedYear && !LEAVE_TYPES.has(r.shift)).map(r => r.date));
  }, [roster, mode, selectedDay, selectedMonth, selectedYear]);

  const activeHandlerCount = useMemo(() => {
    if (mode === 'day') {
      return roster.filter(r => r.date === selectedDay && !LEAVE_TYPES.has(r.shift)).length;
    }
    return new Set(roster.filter(r => activeDates.has(r.date)).map(r => r.handlerId)).size;
  }, [roster, mode, selectedDay, activeDates]);

  // Top performers
  const topPerformers = useMemo(() => {
    const map: Record<string,number> = {};
    filteredStats.forEach(s => { const t=Number(s.incidents||0)+Number(s.sctasks||0)+Number(s.calls||0); if(t>0) map[s.handlerId]=(map[s.handlerId]||0)+t; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,total]) => ({ name:handlers.find(h=>h.id===id)?.name||'Unknown', total }));
  }, [filteredStats, handlers]);

  // Daily breakdown for bar chart (day=hourly placeholder, month=daily, year=monthly)
  const barData = useMemo(() => {
    if (mode === 'day') {
      // per-handler breakdown for the day
      return filteredStats.map(s => ({
        label: handlers.find(h=>h.id===s.handlerId)?.name?.split(' ')[0] || 'Unknown',
        inc: Number(s.incidents||0), task: Number(s.sctasks||0), calls: Number(s.calls||0),
      })).filter(d => d.inc+d.task+d.calls > 0).sort((a,b) => (b.inc+b.task+b.calls)-(a.inc+a.task+a.calls)).slice(0,12);
    }
    if (mode === 'month') {
      // per-day in the month
      const days: Record<string,{inc:number;task:number;calls:number}> = {};
      stats.filter(s => monthOf(s.date) === selectedMonth).forEach(s => {
        if (!days[s.date]) days[s.date] = {inc:0,task:0,calls:0};
        days[s.date].inc   += Number(s.incidents||0);
        days[s.date].task  += Number(s.sctasks  ||0);
        days[s.date].calls += Number(s.calls    ||0);
      });
      return Object.entries(days).sort(([a],[b])=>a.localeCompare(b)).map(([date,v]) => ({ label:date.slice(8), ...v }));
    }
    // year — per-month
    const months: Record<string,{inc:number;task:number;calls:number}> = {};
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    stats.filter(s => yearOf(s.date) === selectedYear).forEach(s => {
      const mKey = monthOf(s.date);
      if (!months[mKey]) months[mKey] = {inc:0,task:0,calls:0};
      months[mKey].inc   += Number(s.incidents||0);
      months[mKey].task  += Number(s.sctasks  ||0);
      months[mKey].calls += Number(s.calls    ||0);
    });
    return Object.entries(months).sort(([a],[b])=>a.localeCompare(b)).map(([m,v]) => ({ label: MONTH_NAMES[parseInt(m.slice(5))-1], ...v }));
  }, [filteredStats, stats, handlers, mode, selectedMonth, selectedYear]);

  // Shift distribution
  const shiftDist = useMemo(() => {
    const dates = mode==='day'?[selectedDay]:mode==='month'?[...activeDates].filter(d=>monthOf(d)===selectedMonth):[...activeDates].filter(d=>yearOf(d)===selectedYear);
    const map: Record<string,number> = {};
    roster.filter(r => dates.includes(r.date) && !LEAVE_TYPES.has(r.shift)).forEach(r => { map[r.shift]=(map[r.shift]||0)+1; });
    return Object.entries(map).map(([shift,value]) => ({ shift, value }));
  }, [roster, mode, selectedDay, selectedMonth, selectedYear, activeDates]);

  // Leave breakdown
  const leaveDist = useMemo(() => {
    const map: Record<string,number> = {};
    roster.filter(r => {
      if (mode==='day') return r.date===selectedDay && LEAVE_TYPES.has(r.shift);
      if (mode==='month') return monthOf(r.date)===selectedMonth && LEAVE_TYPES.has(r.shift);
      return yearOf(r.date)===selectedYear && LEAVE_TYPES.has(r.shift);
    }).forEach(r => { map[r.shift]=(map[r.shift]||0)+1; });
    return Object.entries(map).map(([label,value]) => ({ label, value }));
  }, [roster, mode, selectedDay, selectedMonth, selectedYear]);

  // ── Chart colour palettes ───────────────────────────────────────────────────
  const INC_COLOR   = '#3b82f6';
  const TASK_COLOR  = '#f59e0b';
  const CALL_COLOR  = '#00ADB5';
  const SHIFT_PALETTE = ['#3b82f6','#f59e0b','#f97316','#ef4444','#8b5cf6','#10b981','#ec4899'];

  // ── Navigation labels ───────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (mode==='day') return new Date(selectedDay+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if (mode==='month') { const [y,m]=selectedMonth.split('-'); return new Date(+y,+m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
    return selectedYear;
  },[mode,selectedDay,selectedMonth,selectedYear]);

  const navPeriod=(dir:number)=>{
    if(mode==='day'){ const[y,m,d]=selectedDay.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+dir); setSelectedDay(dt.toLocaleDateString('en-CA')); }
    else if(mode==='month'){ const[y,m]=selectedMonth.split('-').map(Number); const dt=new Date(y,m-1+dir,1); setSelectedMonth(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`); }
    else { setSelectedYear(String(+selectedYear+dir)); }
  };

  // If not admin, show permission denied
  if (role && role !== 'admin') {
    return (
      <div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,opacity:0.4}}>
        <BarChart2 size={48} strokeWidth={1} color="#94a3b8"/>
        <div style={{fontSize:13,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.3em'}}>Admin Access Required</div>
      </div>
    );
  }

  const BORDER='1px solid #e2e8f0';
  const chartDeps = [barData.length, mode, selectedDay, selectedMonth, selectedYear];

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column',overflow:'hidden',background:'#f8fafc',fontFamily:'system-ui,sans-serif'}}>

      {/* ══ TOPBAR ══════════════════════════════════════════════════════════ */}
      <div style={{flexShrink:0,height:46,background:'#fff',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',gap:12}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {/* Brand */}
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
          <div style={{display:'flex',background:'#f1f5f9',borderRadius:8,padding:3,border:BORDER,gap:2}}>
            {(['day','month','year'] as FilterMode[]).map(m=>(
              <button key={m} onClick={()=>setMode(m)} style={{padding:'4px 14px',borderRadius:6,border:'none',cursor:'pointer',fontSize:10,fontWeight:900,textTransform:'uppercase',letterSpacing:'0.12em',transition:'all 0.15s',
                background:mode===m?'#0f172a':'transparent',color:mode===m?'#fff':'#64748b'}}>
                {m}
              </button>
            ))}
          </div>

          {/* Period nav */}
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={()=>navPeriod(-1)} style={{width:26,height:26,border:BORDER,borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <ChevronLeft size={13} color="#64748b"/>
            </button>
            <div style={{padding:'4px 14px',background:'#fff',border:'1px solid #cbd5e1',borderRadius:6,fontSize:11,fontWeight:800,color:'#0f172a',minWidth:200,textAlign:'center',whiteSpace:'nowrap'}}>
              {periodLabel}
              {mode==='day'&&selectedDay===today&&<span style={{marginLeft:8,fontSize:9,fontWeight:900,color:'#2563eb',background:'#dbeafe',borderRadius:4,padding:'1px 6px'}}>TODAY</span>}
            </div>
            <button onClick={()=>navPeriod(1)} style={{width:26,height:26,border:BORDER,borderRadius:6,background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <ChevronRight size={13} color="#64748b"/>
            </button>
          </div>
        </div>

        {/* Right — grand totals */}
        <div style={{display:'flex',border:'1px solid #cbd5e1',borderRadius:6,overflow:'hidden',background:'#fff'}}>
          {[{l:'Incidents',v:totalInc,c:'#2563eb',bg:'#dbeafe'},{l:'SC Tasks',v:totalTask,c:'#b45309',bg:'#fef9c3'},{l:'Calls',v:totalCalls,c:'#00ADB5',bg:'#f0fdfa'},{l:'Total',v:grandTotal,c:'#0f172a',bg:'#f1f5f9'}].map((t,i)=>(
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
          <KpiCard label="Active Handlers" value={activeHandlerCount} sub={mode==='day'?'on shift today':'unique handlers'} Icon={Users} color="#0f172a" bg="#f1f5f9" border="#e2e8f0"/>
          <KpiCard label="Total Handlers"  value={handlers.length}    sub="registered"      Icon={Users} color="#475569" bg="#f8fafc"   border="#e2e8f0"/>
          <KpiCard label="Incidents"        value={totalInc}           sub="logged"          Icon={FileText} color="#2563eb" bg="#dbeafe"   border="#bfdbfe"/>
          <KpiCard label="SC Tasks"         value={totalTask}          sub="completed"       Icon={Activity} color="#b45309" bg="#fef9c3"   border="#fde68a"/>
          <KpiCard label="Calls"            value={totalCalls}         sub="handled"         Icon={PhoneCall} color="#00ADB5" bg="#f0fdfa"   border="#99f6e4"/>
          <KpiCard label="Avg per Agent"    value={activeHandlerCount?Math.round(grandTotal/activeHandlerCount):0} sub="tickets+calls" Icon={TrendingUp} color="#7c3aed" bg="#ede9fe" border="#c4b5fd"/>
        </div>

        {/* Row 2 — Main bar chart + Shift donut */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:10,minHeight:0}}>
          {/* Stacked bar chart */}
          <div style={{background:'#fff',borderRadius:12,border:BORDER,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 16px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>
                  {mode==='day'?'Per Agent':mode==='month'?'Daily Breakdown':'Monthly Breakdown'}
                </div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Productivity Volume</div>
              </div>
              <div style={{display:'flex',gap:12,fontSize:9,fontWeight:700}}>
                {[{c:INC_COLOR,l:'INC'},{c:TASK_COLOR,l:'TASK'},{c:CALL_COLOR,l:'CALLS'}].map(x=>(
                  <div key={x.l} style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:8,height:8,borderRadius:2,background:x.c}}/><span style={{color:'#64748b'}}>{x.l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{flex:1,minHeight:0,padding:'4px 8px 8px'}}>
              {barData.length === 0 ? (
                <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,opacity:0.3}}>
                  <BarChart2 size={32} strokeWidth={1} color="#94a3b8"/>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.2em'}}>No data for this period</span>
                </div>
              ) : (
                <AmChart id="chart-bar" deps={chartDeps} setup={(am5) => {
                  const am5xy  = (window as any).am5xy;
                  const am5th  = (window as any).am5themes_Animated;
                  const root   = am5.Root.new('chart-bar');
                  root.setThemes([am5th.default.new(root)]);
                  const chart  = root.container.children.push(am5xy.XYChart.new(root,{ panX:false,panY:false,wheelX:'none',wheelY:'none',layout:root.verticalLayout }));
                  chart.set('paddingLeft',0); chart.set('paddingRight',8); chart.set('paddingTop',4); chart.set('paddingBottom',0);
                  const xAxis  = chart.xAxes.push(am5xy.CategoryAxis.new(root,{ maxDeviation:0.3,categoryField:'label',renderer:am5xy.AxisRendererX.new(root,{minGridDistance:20,cellStartLocation:0.1,cellEndLocation:0.9}),tooltip:am5.Tooltip.new(root,{}) }));
                  const yAxis  = chart.yAxes.push(am5xy.ValueAxis.new(root,{ min:0,renderer:am5xy.AxisRendererY.new(root,{}) }));
                  xAxis.get('renderer').labels.template.setAll({fontSize:10,fill:am5.color('#64748b'),fontWeight:'700'});
                  yAxis.get('renderer').labels.template.setAll({fontSize:9,fill:am5.color('#94a3b8')});
                  xAxis.get('renderer').grid.template.setAll({strokeOpacity:0});
                  yAxis.get('renderer').grid.template.setAll({stroke:am5.color('#e2e8f0'),strokeOpacity:0.8});
                  const mkSeries=(field:string,name:string,color:string)=>{
                    const s=chart.series.push(am5xy.ColumnSeries.new(root,{name,stacked:true,xAxis,yAxis,valueYField:field,categoryXField:'label',tooltip:am5.Tooltip.new(root,{labelText:'{name}: {valueY}'})}));
                    s.columns.template.setAll({fill:am5.color(color),stroke:am5.color(color),cornerRadiusTL:0,cornerRadiusTR:0,width:am5.percent(70)});
                    return s;
                  };
                  const s1=mkSeries('inc','Incidents',INC_COLOR);
                  const s2=mkSeries('task','SC Tasks',TASK_COLOR);
                  const s3=mkSeries('calls','Calls',CALL_COLOR);
                  xAxis.data.setAll(barData); s1.data.setAll(barData); s2.data.setAll(barData); s3.data.setAll(barData);
                  s1.appear(1000); s2.appear(1000); s3.appear(1000); chart.appear(1000,100);
                  return ()=>root.dispose();
                }}/>
              )}
            </div>
          </div>

          {/* Shift distribution donut */}
          <div style={{background:'#fff',borderRadius:12,border:BORDER,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 0'}}>
              <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Distribution</div>
              <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Shift Coverage</div>
            </div>
            <div style={{flex:1,minHeight:0}}>
              {shiftDist.length === 0 ? (
                <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',opacity:0.3}}>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>No roster data</span>
                </div>
              ) : (
                <AmChart id="chart-donut" deps={[...chartDeps, shiftDist.length]} setup={(am5) => {
                  const am5pct = (window as any).am5percent;
                  const am5th  = (window as any).am5themes_Animated;
                  const root   = am5.Root.new('chart-donut');
                  root.setThemes([am5th.default.new(root)]);
                  const chart  = root.container.children.push(am5pct.PieChart.new(root,{ layout:root.verticalLayout,innerRadius:am5.percent(55) }));
                  const series = chart.series.push(am5pct.PieSeries.new(root,{ valueField:'value',categoryField:'shift',alignLabels:false }));
                  series.labels.template.setAll({fontSize:9,text:'{category}',radius:4,fill:am5.color('#374151'),fontWeight:'700'});
                  series.ticks.template.setAll({strokeOpacity:0.4});
                  series.slices.template.setAll({strokeWidth:2,stroke:am5.color('#fff'),cornerRadius:3});
                  const colors=SHIFT_PALETTE.map(c=>am5.color(c));
                  series.set('colors',am5.ColorSet.new(root,{colors}));
                  series.data.setAll(shiftDist);
                  series.appear(1000); chart.appear(1000,100);
                  return ()=>root.dispose();
                }}/>
              )}
            </div>
          </div>
        </div>

        {/* Row 3 — Leave breakdown + Top performers + Line trend */}
        <div style={{display:'grid',gridTemplateColumns:'220px 1fr 260px',gap:10,minHeight:0}}>

          {/* Leave breakdown */}
          <div style={{background:'#fff',borderRadius:12,border:BORDER,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 6px'}}>
              <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Absences</div>
              <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Leave Breakdown</div>
            </div>
            <div style={{flex:1,minHeight:0,overflow:'hidden',padding:'0 14px 10px',display:'flex',flexDirection:'column',gap:5}}>
              {leaveDist.length===0?(
                <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',opacity:0.3}}>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>No leaves</span>
                </div>
              ):leaveDist.map(({label,value},i)=>{
                const max=Math.max(...leaveDist.map(l=>l.value));
                const pct=max>0?(value/max)*100:0;
                const colors=['#ef4444','#f97316','#f59e0b','#8b5cf6','#10b981','#3b82f6','#ec4899'];
                const c=colors[i%colors.length];
                return (
                  <div key={label} style={{flexShrink:0}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                      <span style={{fontSize:10,fontWeight:700,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:140}}>{label}</span>
                      <span style={{fontSize:11,fontWeight:900,color:c,fontVariantNumeric:'tabular-nums'}}>{value}</span>
                    </div>
                    <div style={{height:5,background:'#f1f5f9',borderRadius:3,overflow:'hidden'}}>
                      <div style={{width:`${pct}%`,height:'100%',background:c,borderRadius:3,transition:'width 0.6s ease'}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trend line chart — incident trend */}
          <div style={{background:'#fff',borderRadius:12,border:BORDER,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 16px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Trend</div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Activity Over Time</div>
              </div>
              <div style={{display:'flex',gap:10,fontSize:9,fontWeight:700}}>
                {[{c:'#3b82f6',l:'INC'},{c:'#00ADB5',l:'CALLS'}].map(x=>(
                  <div key={x.l} style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:16,height:2,borderRadius:1,background:x.c}}/><span style={{color:'#64748b'}}>{x.l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{flex:1,minHeight:0,padding:'4px 8px 8px'}}>
              {barData.length<2?(
                <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,opacity:0.3}}>
                  <TrendingUp size={28} strokeWidth={1} color="#94a3b8"/>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>Need more data points</span>
                </div>
              ):(
                <AmChart id="chart-line" deps={chartDeps} setup={(am5) => {
                  const am5xy = (window as any).am5xy;
                  const am5th = (window as any).am5themes_Animated;
                  const root  = am5.Root.new('chart-line');
                  root.setThemes([am5th.default.new(root)]);
                  const chart = root.container.children.push(am5xy.XYChart.new(root,{panX:true,panY:false,wheelX:'panX',wheelY:'zoomX',layout:root.verticalLayout,cursor:am5xy.XYCursor.new(root,{behavior:'none'})}));
                  chart.set('paddingLeft',0); chart.set('paddingRight',8); chart.set('paddingTop',4); chart.set('paddingBottom',0);
                  const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root,{maxDeviation:0.2,categoryField:'label',renderer:am5xy.AxisRendererX.new(root,{minGridDistance:30}),tooltip:am5.Tooltip.new(root,{})}));
                  const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root,{min:0,renderer:am5xy.AxisRendererY.new(root,{})}));
                  xAxis.get('renderer').labels.template.setAll({fontSize:10,fill:am5.color('#64748b'),fontWeight:'700'});
                  yAxis.get('renderer').labels.template.setAll({fontSize:9,fill:am5.color('#94a3b8')});
                  yAxis.get('renderer').grid.template.setAll({stroke:am5.color('#e2e8f0'),strokeOpacity:0.8});
                  xAxis.get('renderer').grid.template.setAll({strokeOpacity:0});
                  const mkLine=(field:string,name:string,color:string)=>{
                    const s=chart.series.push(am5xy.SmoothedXLineSeries.new(root,{name,xAxis,yAxis,valueYField:field,categoryXField:'label',tooltip:am5.Tooltip.new(root,{labelText:'{name}: {valueY}'})}));
                    s.set('stroke',am5.color(color)); s.set('fill',am5.color(color));
                    s.strokes.template.setAll({strokeWidth:2});
                    const gradient=am5.LinearGradient.new(root,{stops:[{color:am5.color(color),opacity:0.25},{color:am5.color(color),opacity:0.02}],rotation:90});
                    s.fills.template.setAll({fillGradient:gradient,visible:true});
                    s.bullets.push(()=>am5.Bullet.new(root,{sprite:am5.Circle.new(root,{radius:3,fill:am5.color(color),stroke:am5.color('#fff'),strokeWidth:1.5})}));
                    return s;
                  };
                  const sl=mkLine('inc','Incidents',INC_COLOR); const sc=mkLine('calls','Calls',CALL_COLOR);
                  xAxis.data.setAll(barData); sl.data.setAll(barData); sc.data.setAll(barData);
                  sl.appear(1000); sc.appear(1000); chart.appear(1000,100);
                  return ()=>root.dispose();
                }}/>
              )}
            </div>
          </div>

          {/* Top performers */}
          <div style={{background:'#fff',borderRadius:12,border:BORDER,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'10px 14px 6px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:900,textTransform:'uppercase',letterSpacing:'0.2em'}}>Rankings</div>
                <div style={{fontSize:13,fontWeight:900,color:'#0f172a',marginTop:2}}>Top Performers</div>
              </div>
              <Award size={16} color="#f59e0b"/>
            </div>
            <div style={{flex:1,minHeight:0,overflow:'hidden',padding:'0 14px 10px',display:'flex',flexDirection:'column',gap:6}}>
              {topPerformers.length===0?(
                <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',opacity:0.3}}>
                  <span style={{fontSize:10,fontWeight:700,color:'#94a3b8'}}>No data</span>
                </div>
              ):topPerformers.map(({name,total},i)=>{
                const max=topPerformers[0].total;
                const pct=max>0?(total/max)*100:0;
                const medals=['🥇','🥈','🥉','4th','5th'];
                const colors=['#f59e0b','#94a3b8','#b45309','#64748b','#94a3b8'];
                return (
                  <div key={name} style={{flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{fontSize:11}}>{medals[i]||`${i+1}th`}</span>
                        <span style={{fontSize:11,fontWeight:700,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}}>{name}</span>
                      </div>
                      <span style={{fontSize:12,fontWeight:900,color:colors[i]||'#64748b',fontVariantNumeric:'tabular-nums'}}>{total}</span>
                    </div>
                    <div style={{height:5,background:'#f1f5f9',borderRadius:3,overflow:'hidden'}}>
                      <div style={{width:`${pct}%`,height:'100%',background:colors[i]||'#94a3b8',borderRadius:3,transition:'width 0.6s ease'}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;

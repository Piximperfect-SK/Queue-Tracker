import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, X, CheckCircle2, AlertCircle, Database, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { syncData, socket } from '../utils/socket';

// ── Shift normalisation ───────────────────────────────────────────────────────
const SHIFT_MAP: Record<string, string> = {
  'morning shift': '6AM-3PM', 'morning': '6AM-3PM', 'ms': '6AM-3PM',
  'afternoon': '1PM-10PM', 'afternoon shift': '1PM-10PM', 'as': '1PM-10PM',
  'afternoon_non-voice': '1PM-10PM',
  'night shift': '10PM-7AM', 'night': '10PM-7AM', 'ns': '10PM-7AM',
  'noon night': '10PM-7AM', 'nn': '10PM-7AM',
  'planned leave': 'Planned Leave', 'pl': 'Planned Leave',
  'week off': 'WeekOff', 'weekoff': 'WeekOff', 'weekoff ': 'WeekOff', 'wo': 'WeekOff',
  'earned leave': 'Earned Leave', 'el': 'Earned Leave',
  'medical leave': 'Medical Leave', 'ml': 'Medical Leave',
  'sick leave': 'Medical Leave', 'sick leave ': 'Medical Leave',
  'unplanned leave': 'Unplanned Leave', 'unplanned leave ': 'Unplanned Leave', 'ul': 'Unplanned Leave',
  'complimentary off': 'Complimentary Off', 'comp off': 'Complimentary Off', 'co': 'Complimentary Off',
  'mid-leave': 'MID-LEAVE',
  'half day': 'Planned Leave', 'halfday': 'Planned Leave', 'half day ': 'Planned Leave',
  'leave': 'Planned Leave',
  'ojt': '1PM-10PM',
};
const normShift = (s: string) => SHIFT_MAP[s.toLowerCase().trim()] ?? s.trim();

const normName = (n: string) => n.trim()
  .replace(/\s+/g, ' ')
  .split(' ')
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(' ');

// ── Types ─────────────────────────────────────────────────────────────────────
interface ImportRow {
  date: string;
  name: string;
  shift: string;
  incidents: number;
  sctasks: number;
  calls: number;
}

interface ImportResult {
  rows: number;
  agents: number;
  rosterEntries: number;
  statsEntries: number;
  skipped: number;
  months: string[];
  errors: string[];
  handlers: { id: string; name: string; isQH: boolean; workType?: 'voice' | 'non-voice' }[];
  roster: ImportRow[];
  stats: { handlerId: string; date: string; incidents: number; sctasks: number; calls: number; comments: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const LEAVE_TYPES = new Set(['Planned Leave','WeekOff','Earned Leave','Medical Leave','Unplanned Leave','Complimentary Off','MID-LEAVE']);
const createId = () => typeof crypto !== 'undefined' && (crypto as any).randomUUID
  ? (crypto as any).randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function parseXlsx(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        // Prefer "Import Ready" sheet, fallback to first
        const sheetName = wb.SheetNames.includes('Import Ready')
          ? 'Import Ready'
          : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

        const rows: ImportRow[] = [];
        for (const row of raw) {
          // Column name detection — handle varied headers
          const date  = row['Date (YYYY-MM-DD)'] || row['Date'] || row['date'] || '';
          const name  = row['Employee Name'] || row['Name'] || row['Agent'] || row['name'] || '';
          const shift = row['Shift'] || row['shift'] || '';
          const inc   = parseInt(row['Incidents'] || row['New Incidents'] || row['Incident'] || '0') || 0;
          const task  = parseInt(row['Requests / SCTASK'] || row['SCTASK'] || row['SC Task'] || '0') || 0;
          const calls = parseInt(row['Calls'] || row['calls'] || '0') || 0;

          if (!date || !name || !/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) continue;
          if (!name.trim()) continue;

          rows.push({
            date:      String(date).trim(),
            name:      normName(String(name)),
            shift:     normShift(String(shift)),
            incidents: Math.max(0, inc),
            sctasks:   Math.max(0, task),
            calls:     Math.max(0, calls),
          });
        }
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

function doImport(rows: ImportRow[], existingHandlers: any[], existingRoster: any[], existingStats: any[]): ImportResult {

  // Build name→id map (normalised)
  const nameMap = new Map<string, string>();
  existingHandlers.forEach(h => nameMap.set(normName(h.name).toLowerCase(), h.id));

  const newHandlers = [...existingHandlers];
  const rosterMap   = new Map<string, any>(); // "handlerId::date" → entry
  const statsMap    = new Map<string, any>(); // "handlerId::date" → entry

  // Seed maps from existing
  existingRoster.forEach(r => rosterMap.set(`${r.handlerId}::${r.date}`, r));
  existingStats.forEach(s  => statsMap.set(`${s.handlerId}::${s.date}`,  s));

  const months     = new Set<string>();
  const errors: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const key = row.name.toLowerCase();
    let hid = nameMap.get(key);
    if (!hid) {
      hid = createId();
      nameMap.set(key, hid);
      newHandlers.push({ id: hid, name: row.name, isQH: false });
    }

    months.add(row.date.slice(0, 7));

    // Roster entry
    const rKey = `${hid}::${row.date}`;
    rosterMap.set(rKey, { handlerId: hid, date: row.date, shift: row.shift });

    // Stats entry — only for active shifts
    if (!LEAVE_TYPES.has(row.shift)) {
      const existing = statsMap.get(rKey);
      // Prefer higher value (don't overwrite good data with zeros)
      const inc   = Math.max(row.incidents, existing?.incidents || 0);
      const task  = Math.max(row.sctasks,   existing?.sctasks   || 0);
      const calls = Math.max(row.calls,      existing?.calls     || 0);
      statsMap.set(rKey, {
        handlerId: hid, date: row.date,
        incidents: inc, sctasks: task, calls, comments: existing?.comments || '',
      });
    }
  }

  const finalRoster = Array.from(rosterMap.values());
  const finalStats  = Array.from(statsMap.values());

  return {
    rows:         rows.length,
    agents:       newHandlers.length - existingHandlers.length,
    rosterEntries: finalRoster.length,
    statsEntries:  finalStats.length,
    skipped,
    months:       Array.from(months).sort(),
    errors,
    handlers:     newHandlers,
    roster:       finalRoster,
    stats:        finalStats,
  };
}

const fetchCurrentState = async () => new Promise<{ handlers: any[]; roster: any[]; stats: any[] }>((resolve, reject) => {
  const finish = (db: any) => {
    resolve({
      handlers: Array.isArray(db?.handlers || db?.agents) ? (db.handlers || db.agents) : [],
      roster: Array.isArray(db?.roster) ? db.roster : [],
      stats: Array.isArray(db?.stats) ? db.stats : [],
    });
  };

  const onInit = (db: any) => {
    socket.off('init', onInit);
    clearTimeout(timer);
    finish(db);
  };

  if (!socket.connected) {
    reject(new Error('Not connected to the server'));
    return;
  }

  const timer = setTimeout(() => {
    socket.off('init', onInit);
    reject(new Error('Timed out while loading current data from the server'));
  }, 12000);

  socket.once('init', onInit);
  socket.emit('get_initial_data');
});

// ── Component ─────────────────────────────────────────────────────────────────
const HistoryImporter: React.FC = () => {
  const [open,    setOpen]    = useState(false);
  const [stage,   setStage]   = useState<'idle'|'parsing'|'preview'|'importing'|'done'|'error'>('idle');
  const [preview, setPreview] = useState<{ rows: ImportRow[]; months: string[]; agents: Set<string> } | null>(null);
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [errMsg,  setErrMsg]  = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setStage('parsing');
    setErrMsg('');
    try {
      const rows = await parseXlsx(file);
      if (!rows.length) throw new Error('No valid rows found. Make sure the file has a "Date (YYYY-MM-DD)" column and "Employee Name" column.');
      const months  = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
      const agents  = new Set(rows.map(r => r.name));
      setPreview({ rows, months, agents });
      setStage('preview');
    } catch (err: any) {
      setErrMsg(err?.message || 'Parse failed');
      setStage('error');
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setStage('importing');
    try {
      const currentState = await fetchCurrentState();
      const res = doImport(preview.rows, currentState.handlers, currentState.roster, currentState.stats);

      const rosterEntries = res.roster.filter((r) => preview.months.includes(r.date?.slice(0, 7)));
      const statsEntries = res.stats.filter((s) => preview.months.includes(s.date?.slice(0, 7)));

      // Push handlers+roster first, then stats
      await new Promise<void>((resolve) => {
        if (!socket.connected) { resolve(); return; }
        syncData.updateHandlersImport(res.handlers, rosterEntries as any, (ack) => {
          console.log('Handlers+Roster import ack:', ack);
          resolve();
        });
        // fallback if no ack in 10s
        setTimeout(resolve, 10000);
      });

      // Push stats in chunks of 500 to avoid socket timeout
      const CHUNK = 500;
      for (let i = 0; i < statsEntries.length; i += CHUNK) {
        const chunk = statsEntries.slice(i, i + CHUNK);
        await new Promise<void>((resolve) => {
          if (!socket.connected) { resolve(); return; }
          syncData.updateStatsImport(chunk, (ack) => {
            console.log(`Stats chunk ${i}-${i+chunk.length} ack:`, ack);
            resolve();
          });
          setTimeout(resolve, 15000); // 15s timeout per chunk
        });
      }

      setResult(res);
      setStage('done');
    } catch (err: any) {
      setErrMsg(err?.message || 'Import failed');
      setStage('error');
    }
  };

  const reset = () => {
    setStage('idle'); setPreview(null); setResult(null); setErrMsg(''); setShowErrors(false);
  };

  const B = '1px solid #e2e8f0';

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 14px', border: '1px solid #c7d2fe', borderRadius: 6,
          background: '#eef2ff', cursor: 'pointer', fontSize: 10, fontWeight: 700,
          color: '#4f46e5', whiteSpace: 'nowrap',
        }}
      >
        <Database size={12} />
        Import History
      </button>

      {/* Modal */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          {/* Backdrop */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }} onClick={() => { setOpen(false); reset(); }} />

          {/* Modal box */}
          <div style={{
            position: 'relative', background: '#fff', borderRadius: 16, width: 540,
            maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,0.18)', border: B,
          }}>
            {/* Header */}
            <div style={{ padding: '18px 20px 14px', borderBottom: B, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#eef2ff', border: '1px solid #c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Database size={18} color="#4f46e5" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1 }}>Import History Data</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3 }}>Load historical roster + productivity stats from Excel</div>
                </div>
              </div>
              <button onClick={() => { setOpen(false); reset(); }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={16} color="#94a3b8" />
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

              {/* ── IDLE: Drop zone ── */}
              {stage === 'idle' && (
                <div>
                  {/* Expected format info */}
                  <div style={{ background: '#f8fafc', border: B, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Expected columns</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {['Date (YYYY-MM-DD)','Employee Name','Shift','Incidents','Requests / SCTASK','Calls'].map(c => (
                        <span key={c} style={{ fontSize: 9, fontWeight: 700, color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 4, padding: '2px 6px' }}>{c}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 6 }}>Use the "Import Ready" sheet from your Queue Tracker Excel. Dates must be YYYY-MM-DD format.</div>
                  </div>

                  {/* Drop zone */}
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: '2px dashed #c7d2fe', borderRadius: 12, padding: '36px 24px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#4f46e5', e.currentTarget.style.background = '#f5f3ff')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#c7d2fe', e.currentTarget.style.background = 'transparent')}
                  >
                    <Upload size={28} color="#4f46e5" strokeWidth={1.5} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Click to select file</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>.xlsx · .xls · .csv</div>
                  </div>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFile} />
                </div>
              )}

              {/* ── PARSING ── */}
              {stage === 'parsing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 14 }}>
                  <Loader size={32} color="#4f46e5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Reading file…</div>
                </div>
              )}

              {/* ── PREVIEW ── */}
              {stage === 'preview' && preview && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Summary cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {[
                      { label: 'Rows', value: preview.rows.length.toLocaleString(), color: '#4f46e5', bg: '#eef2ff' },
                      { label: 'Agents', value: preview.agents.size, color: '#0f172a', bg: '#f1f5f9' },
                      { label: 'Months', value: preview.months.length, color: '#059669', bg: '#f0fdf4' },
                    ].map(s => (
                      <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 8, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Month range */}
                  <div style={{ background: '#f8fafc', border: B, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Date range</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>
                      {preview.months[0]} → {preview.months[preview.months.length - 1]}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {preview.months.map(m => (
                        <span key={m} style={{ fontSize: 8, fontWeight: 700, color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 6px' }}>{m}</span>
                      ))}
                    </div>
                  </div>

                  {/* Agent list */}
                  <div style={{ background: '#f8fafc', border: B, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>
                      Agents ({preview.agents.size})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 80, overflow: 'auto' }}>
                      {[...preview.agents].sort().map(a => (
                        <span key={a} style={{ fontSize: 9, fontWeight: 600, color: '#374151', background: '#fff', border: B, borderRadius: 4, padding: '1px 6px' }}>{a}</span>
                      ))}
                    </div>
                  </div>

                  {/* Warning */}
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8 }}>
                    <AlertCircle size={14} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600, lineHeight: 1.5 }}>
                      This will <strong>merge</strong> historical data into the app. Existing entries for the same agent + date will be updated only if the imported values are higher. New agents will be registered automatically.
                    </div>
                  </div>
                </div>
              )}

              {/* ── IMPORTING ── */}
              {stage === 'importing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 14 }}>
                  <Loader size={32} color="#4f46e5" style={{ animation: 'spin 1s linear infinite' }} />
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Importing {preview?.rows.length.toLocaleString()} rows…</div>
                </div>
              )}

              {/* ── DONE ── */}
              {stage === 'done' && result && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                    <CheckCircle2 size={22} color="#16a34a" style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#15803d' }}>Import Successful</div>
                      <div style={{ fontSize: 10, color: '#166534', marginTop: 2 }}>
                        {result.rows.toLocaleString()} rows · {result.agents} new agents · {result.months.length} months loaded
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                    {[
                      { label: 'Roster entries', value: result.rosterEntries.toLocaleString(), color: '#0f172a' },
                      { label: 'Stats entries',  value: result.statsEntries.toLocaleString(),  color: '#0f172a' },
                      { label: 'New agents',     value: result.agents,                          color: '#4f46e5' },
                      { label: 'Months covered', value: result.months.length,                  color: '#059669' },
                    ].map(s => (
                      <div key={s.label} style={{ background: '#f8fafc', border: B, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 8, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#f8fafc', border: B, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Months imported</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {result.months.map(m => (
                        <span key={m} style={{ fontSize: 8, fontWeight: 700, color: '#059669', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 6px' }}>{m}</span>
                      ))}
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px' }}>
                      <button
                        onClick={() => setShowErrors(s => !s)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 900, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.15em' }}
                      >
                        <AlertCircle size={11} />
                        {result.errors.length} warnings
                        {showErrors ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                      {showErrors && (
                        <div style={{ marginTop: 8, maxHeight: 120, overflow: 'auto' }}>
                          {result.errors.map((e, i) => (
                            <div key={i} style={{ fontSize: 9, color: '#dc2626', padding: '1px 0' }}>{e}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center' }}>
                    Go to the <strong>Analytics Dashboard</strong> and switch to Year/Month view to see historical data.
                  </div>
                </div>
              )}

              {/* ── ERROR ── */}
              {stage === 'error' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 0' }}>
                  <AlertCircle size={36} color="#dc2626" strokeWidth={1.5} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textAlign: 'center' }}>{errMsg}</div>
                  <button onClick={reset} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', fontSize: 11, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>
                    Try Again
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10, flexShrink: 0, borderTop: stage !== 'idle' ? B : 'none', paddingTop: stage !== 'idle' ? 16 : 0 }}>
              {stage === 'preview' && (
                <>
                  <button onClick={() => { reset(); }} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: B, background: '#f8fafc', fontSize: 11, fontWeight: 900, color: '#64748b', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Cancel
                  </button>
                  <button onClick={handleImport} style={{
                    flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(145deg,#4f46e5,#3730a3)',
                    boxShadow: '0 4px 0 #312e81, 0 6px 12px rgba(79,70,229,0.3)',
                    fontSize: 11, fontWeight: 900, color: '#fff', cursor: 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    transition: 'all 0.1s',
                  }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'translateY(3px)'; e.currentTarget.style.boxShadow = '0 1px 0 #312e81'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 0 #312e81, 0 6px 12px rgba(79,70,229,0.3)'; }}
                  >
                    ⬇ Import {preview.rows.length.toLocaleString()} rows
                  </button>
                </>
              )}
              {stage === 'done' && (
                <button onClick={() => { setOpen(false); reset(); }} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#0f172a', fontSize: 11, fontWeight: 900, color: '#fff', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Done — View Analytics
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
};

export default HistoryImporter;

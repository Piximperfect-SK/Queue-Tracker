import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, ChevronRight, ChevronLeft, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Compass } from 'lucide-react';

interface GuideStep {
  title: string;
  description: string;
  route?: string;
  arrow: 'top' | 'bottom' | 'left' | 'right';
  selector?: string;
  hint?: string;
}

const STEPS: GuideStep[] = [
  {
    title: '📋 Roster — Daily Schedule',
    description: 'This is where you build and manage the daily agent roster. Drag & drop agents into shifts, assign leaves, and see who\'s on duty at a glance.',
    route: '/',
    arrow: 'bottom',
    selector: 'a[href="/"]',
    hint: 'Start here every day to set up your team'
  },
  {
    title: '📊 Tracker — Live Metrics',
    description: 'Monitor queue performance and call tracking in real time. See stats, update call data, and track productivity across all shifts.',
    route: '/tracker',
    arrow: 'bottom',
    selector: 'a[href="/tracker"]',
    hint: 'Keep this open during peak hours'
  },
  {
    title: '⚙️ Settings — Manage Handlers',
    description: 'Add or remove agents, configure shift templates, and manage app preferences. Everything you need to customise the system.',
    route: '/settings',
    arrow: 'bottom',
    selector: 'a[href="/settings"]',
    hint: 'Set up your team here first'
  },
  {
    title: '🎯 Drag & Drop Rostering',
    description: 'Click and drag agent cards between shifts to quickly reassign. Drop on "Off Duty" to mark leaves, or use the trash zone to remove.',
    route: '/',
    arrow: 'top',
    hint: 'The fastest way to rearrange your roster'
  },
  {
    title: '📥 Import Roster',
    description: 'Upload Excel files or take a screenshot of any roster table — the AI will automatically parse and apply it to save you hours of manual entry.',
    route: '/',
    arrow: 'right',
    hint: 'Great for bulk updates from external sheets'
  },
  {
    title: '🔍 Off-Duty Overview',
    description: 'Click the "Off" count to see which agents are on leave and why. Every leave type is colour-coded for quick scanning.',
    route: '/',
    arrow: 'top',
    hint: 'Stay on top of attendance at a glance'
  },
];



const TOOLTIP_OFFSET = 16;

const TargetHighlight: React.FC<{ selector: string }> = ({ selector }) => {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = () => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [selector]);
  if (!rect) return null;
  return (
    <div
      className="fixed z-[9999] pointer-events-none rounded-xl border-2 border-indigo-400 shadow-[0_0_0_4px_rgba(99,102,241,0.15)] animate-pulse"
      style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
    />
  );
};

const NewUserGuide: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [visible, setVisible] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const step = STEPS[stepIndex];

  const reposition = useCallback(() => {
    const s = STEPS[stepIndex];
    if (!s.selector) {
      setTooltipStyle({ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      return;
    }
    const el = document.querySelector(s.selector);
    if (!el) {
      setTooltipStyle({ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      return;
    }
    const rect = el.getBoundingClientRect();
    const style: React.CSSProperties = { position: 'fixed' };
    switch (s.arrow) {
      case 'bottom': style.top = rect.bottom + TOOLTIP_OFFSET; style.left = rect.left + rect.width / 2; style.transform = 'translateX(-50%)'; break;
      case 'top': style.bottom = window.innerHeight - rect.top + TOOLTIP_OFFSET; style.left = rect.left + rect.width / 2; style.transform = 'translateX(-50%)'; break;
      case 'left': style.top = rect.top + rect.height / 2; style.right = window.innerWidth - rect.left + TOOLTIP_OFFSET; style.transform = 'translateY(-50%)'; break;
      case 'right': style.top = rect.top + rect.height / 2; style.left = rect.right + TOOLTIP_OFFSET; style.transform = 'translateY(-50%)'; break;
    }
    setTooltipStyle(style);
  }, [stepIndex]);

  useEffect(() => {
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [reposition, stepIndex, location.pathname]);

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) {
      const next = STEPS[stepIndex + 1];
      if (next.route && next.route !== location.pathname) navigate(next.route);
      setTimeout(() => setStepIndex(i => i + 1), 50);
    } else {
      handleComplete();
    }
  };

  const goPrev = () => {
    if (stepIndex > 0) {
      const prev = STEPS[stepIndex - 1];
      if (prev.route && prev.route !== location.pathname) navigate(prev.route);
      setTimeout(() => setStepIndex(i => i - 1), 50);
    }
  };

  const handleComplete = () => {
    setVisible(false);
    localStorage.setItem('newUserGuideSeen', 'true');
    setTimeout(onComplete, 300);
  };

  if (!visible) return null;

  const ArrowIcon = step.arrow === 'top' ? ArrowUp
    : step.arrow === 'bottom' ? ArrowDown
    : step.arrow === 'left' ? ArrowLeft : ArrowRight;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={handleComplete} />
      {step.selector && <TargetHighlight selector={step.selector} />}
      <div style={tooltipStyle} className="fixed z-[10000] max-w-sm w-full animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
        <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 p-5">
          <div className={`absolute w-3 h-3 bg-white border-l border-t border-slate-200 rotate-45 ${step.arrow === 'top' ? '-top-1.5 left-1/2 -translate-x-1/2' : step.arrow === 'bottom' ? '-bottom-1.5 left-1/2 -translate-x-1/2' : step.arrow === 'left' ? 'left-1.5 top-1/2 -translate-y-1/2' : 'right-1.5 top-1/2 -translate-y-1/2'}`} />
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Compass size={16} className="text-indigo-600" />
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Step {stepIndex + 1} of {STEPS.length}</span>
            </div>
            <button onClick={handleComplete} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"><X size={14} /></button>
          </div>
          <div className="flex gap-1 mb-4">
            {STEPS.map((_, i) => (<div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === stepIndex ? 'w-6 bg-indigo-600' : i < stepIndex ? 'w-2 bg-indigo-300' : 'w-2 bg-slate-200'}`} />))}
          </div>
          <h3 className="text-[15px] font-black text-slate-900 mb-1.5 leading-snug">{step.title}</h3>
          <p className="text-[12px] text-slate-600 font-medium leading-relaxed mb-3">{step.description}</p>
          {step.hint && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
              <ArrowIcon size={14} className="text-indigo-500 shrink-0" />
              <span className="text-[10px] font-bold text-indigo-700">{step.hint}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <button onClick={handleComplete} className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors">Skip All</button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && <button onClick={goPrev} className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"><ChevronLeft size={16} /></button>}
              <button onClick={goNext} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest transition-all shadow-md">
                {stepIndex < STEPS.length - 1 ? <><span>Next</span><ChevronRight size={14} /></> : <span>✨ Got It</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default NewUserGuide;


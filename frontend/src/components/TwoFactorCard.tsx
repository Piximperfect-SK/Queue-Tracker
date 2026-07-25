import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Copy, Check, AlertCircle, KeyRound } from 'lucide-react';
import { authHeaders } from '../utils/authToken';

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

type Stage = 'idle' | 'setup' | 'confirm' | 'disable';

const TwoFactorCard: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [savedBackupCodes, setSavedBackupCodes] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api('/api/access/2fa/status');
      setEnabled(data.enabled);
    } catch (_) {
      setEnabled(null);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/api/access/2fa/setup', { method: 'POST' });
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setBackupCodes(data.backupCodes);
      setSavedBackupCodes(false);
      setStage('setup');
    } catch (err: any) {
      setError(err.message || 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/access/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setEnabled(true);
      setStage('idle');
      setCode('');
      setQrDataUrl(null);
      setSecret(null);
      setBackupCodes(null);
    } catch (err: any) {
      setError(err.message || 'Incorrect code');
    } finally {
      setBusy(false);
    }
  };

  const submitDisable = async () => {
    if (!code.trim()) {
      setError('Enter a code from your authenticator app or a backup code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/access/2fa/disable', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setEnabled(false);
      setStage('idle');
      setCode('');
    } catch (err: any) {
      setError(err.message || 'Incorrect code');
    } finally {
      setBusy(false);
    }
  };

  const copySecret = () => {
    if (!secret) return;
    navigator.clipboard.writeText(secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const cancel = () => {
    setStage('idle');
    setCode('');
    setError(null);
    setQrDataUrl(null);
    setSecret(null);
    setBackupCodes(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
          {enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Two-Factor Authentication</h2>
          <p className="text-[11px] text-slate-400">{enabled === null ? 'Checking…' : enabled ? 'Enabled — protecting your name' : 'Not enabled'}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs font-semibold text-red-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {stage === 'idle' && (
        enabled ? (
          <button
            onClick={() => { setStage('disable'); setError(null); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-red-200 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 transition-all active:scale-95"
          >
            Disable 2FA
          </button>
        ) : (
          <button
            onClick={startSetup}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Enable 2FA
          </button>
        )
      )}

      {stage === 'setup' && qrDataUrl && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">Scan with Microsoft Authenticator, Google Authenticator, or any TOTP app — Microsoft Authenticator works here without signing into a Microsoft account.</p>
          <img src={qrDataUrl} alt="2FA QR code" className="w-40 h-40 mx-auto rounded-xl border border-slate-200" />
          {secret && (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 truncate">{secret}</code>
              <button onClick={copySecret} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
                {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              </button>
            </div>
          )}
          {backupCodes && !savedBackupCodes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide mb-2">Save these backup codes — shown once</p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {backupCodes.map((c) => (
                  <code key={c} className="text-[11px] font-mono bg-white border border-amber-200 rounded px-2 py-1 text-center">{c}</code>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-amber-800">
                <input type="checkbox" checked={savedBackupCodes} onChange={(e) => setSavedBackupCodes(e.target.checked)} className="w-3.5 h-3.5 accent-amber-600" />
                I've saved these codes somewhere safe
              </label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <KeyRound size={12} className="text-slate-400" />
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter the 6-digit code to confirm"
              disabled={!savedBackupCodes && !!backupCodes}
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono tracking-widest focus:border-slate-400 focus:bg-white outline-none transition-all disabled:opacity-50"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={cancel} className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all">Cancel</button>
            <button
              onClick={confirmSetup}
              disabled={busy || (!!backupCodes && !savedBackupCodes)}
              className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {stage === 'disable' && (
        <div className="space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code or backup code"
            autoFocus
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono tracking-widest focus:border-red-400 focus:bg-white outline-none transition-all"
          />
          <div className="flex gap-2">
            <button onClick={cancel} className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all">Cancel</button>
            <button
              onClick={submitDisable}
              disabled={busy}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm Disable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TwoFactorCard;

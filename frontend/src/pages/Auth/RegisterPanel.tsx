import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';

const RegisterPanel: React.FC<{ onCancel?: () => void }> = ({ onCancel }) => {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(fullName, username, password, code);
      setSuccess('Registered successfully');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">{success}</div>}

      <div className="group">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Full Name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-4 py-3 bg-white/80 rounded-xl border border-white/30 outline-none" placeholder="Jane Doe" required />
      </div>

      <div className="group">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-4 py-3 bg-white/80 rounded-xl border border-white/30 outline-none" placeholder="your.username" required />
      </div>

      <div className="group">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 bg-white/80 rounded-xl border border-white/30 outline-none" placeholder="••••••••" type="password" required />
      </div>

      <div className="group">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registration Code</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-4 py-3 bg-white/80 rounded-xl border border-white/30 outline-none" placeholder="Registration code" required />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={loading} className="flex-1 bg-[#222831] text-white py-3 rounded-full font-black">{loading ? 'Creating...' : 'Create account'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-3 rounded-full border bg-white/40">Cancel</button>
      </div>
    </form>
  );
};

export default RegisterPanel;

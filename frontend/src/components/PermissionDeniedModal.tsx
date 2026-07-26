import React from 'react';
import { ShieldOff, X } from 'lucide-react';

interface PermissionDeniedModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: string;
}

const PermissionDeniedModal: React.FC<PermissionDeniedModalProps> = ({ isOpen, onClose, action }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[999] p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-rose-200 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-rose-100 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-500 shrink-0">
              <ShieldOff size={20} />
            </div>
            <div>
              <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Access Denied</h3>
              <p className="text-[9px] text-rose-600 uppercase tracking-widest font-bold mt-0.5">Restricted Action</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-[12px] text-slate-600 leading-relaxed mb-1">
            <span className="font-bold text-slate-900">{action}</span>
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Your role does not have permission to perform this action. Contact your administrator if you believe this is a mistake.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg font-bold text-[11px] uppercase tracking-widest bg-rose-50 hover:bg-rose-100 text-rose-600 transition-all"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionDeniedModal;

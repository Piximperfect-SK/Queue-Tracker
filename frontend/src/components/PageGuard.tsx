import React from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useRole, type PagePermissions } from '../auth/RoleContext';

interface PageGuardProps {
  page: keyof PagePermissions;
  children: React.ReactNode;
}

/**
 * Wrap a route's element with this to enforce the page-level permission
 * fetched from the backend (GET /api/access/permissions). This is a UX
 * guard, not the security boundary — the real enforcement is server-side
 * (middleware/permissions.js on HTTP routes, checkSocketAction on socket
 * events). This just avoids showing a broken/empty page to someone who
 * isn't going to be able to do anything on it anyway.
 */
const PageGuard: React.FC<PageGuardProps> = ({ page, children }) => {
  const { pages, loadingRole } = useRole();

  if (loadingRole) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }

  if (!pages[page]) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500 mb-4 border border-rose-100">
          <ShieldAlert size={28} />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Access Restricted</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Your role doesn't have permission to view this page. Contact an Admin if you believe this is a mistake.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};

export default PageGuard;

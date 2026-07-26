import RolePermission, { DEFAULT_PERMISSIONS } from '../models/RolePermission.js';

/**
 * Fetch the effective permission doc for a role, falling back to defaults
 * if Admin hasn't customized it yet. Admin role is always fully permitted
 * and never touches the DB.
 */
export async function getPermissionsForRole(role) {
  if (role === 'admin') {
    return {
      pages: { roster: true, stats: true, logMonitor: true, settings: true, admin: true },
      actions: {
        editRoster: true,
        editHandlers: true,
        deleteLog: true,
        exportData: true,
        manageUsers: true,
        downloadLogs: true,
        shiftManagement: true,
        importRoster: true,
        manageRoles: true,
        manage2FA: true,
        manageAccessCodes: true,
        manageSessions: true,
      },
    };
  }

  const stored = await RolePermission.findOne({ role }).lean();
  if (stored) return { pages: stored.pages, actions: stored.actions };
  return DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.associate;
}

/** HTTP middleware: gate a route on a page-level permission. Requires req.user already set (role + fullName) by requireAuth. */
export function requirePage(pageKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const perms = await getPermissionsForRole(req.user.role);
      if (!perms.pages[pageKey]) {
        return res.status(403).json({ error: `Forbidden: no access to '${pageKey}'` });
      }
      return next();
    } catch (err) {
      console.error('Permission check failed:', err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/** HTTP middleware: gate a route on an action-level permission. */
export function requireAction(actionKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const perms = await getPermissionsForRole(req.user.role);
      if (!perms.actions[actionKey]) {
        return res.status(403).json({ error: `Forbidden: missing permission '${actionKey}'` });
      }
      return next();
    } catch (err) {
      console.error('Permission check failed:', err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Socket-side equivalent, since socket.io handlers aren't Express middleware.
 * Call this at the top of any handler that mutates data.
 * Returns true if allowed; emits an 'error' event and returns false if not.
 */
export async function checkSocketAction(socket, actionKey) {
  if (!socket.user) {
    socket.emit('error', { message: 'Unauthorized: no active session' });
    return false;
  }
  try {
    const perms = await getPermissionsForRole(socket.user.role);
    if (!perms.actions[actionKey]) {
      socket.emit('error', { message: `Forbidden: missing permission '${actionKey}'` });
      return false;
    }
    return true;
  } catch (err) {
    console.error('Socket permission check failed:', err);
    socket.emit('error', { message: 'Permission check failed' });
    return false;
  }
}

import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import AccessCode, { encryptCode, decryptCode, generateCode } from '../models/AccessCode.js';
import RolePermission, { DEFAULT_PERMISSIONS, PAGE_KEYS, ACTION_KEYS } from '../models/RolePermission.js';
import { requireAuth } from '../middleware/auth.js';
import { getPermissionsForRole } from '../middleware/permissions.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

// Same brute-force protection posture as the password login in auth.js.
const codeLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin only' });
  }
  return next();
}

// --- Login with Full Name + Access Code -------------------------------
// The code determines the role server-side. The client can no longer
// declare its own role — this replaces the old name-only socket join flow.
router.post('/access/login', codeLoginLimiter, async (req, res) => {
  try {
    const { fullName, code } = req.body;
    if (typeof fullName !== 'string' || typeof code !== 'string' || !fullName.trim() || !code.trim()) {
      return res.status(400).json({ error: 'Full name and access code are required' });
    }
    // Reject anything that isn't a plain 6-digit PIN outright — this also
    // means the comparison below never handles anything but a short string.
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
    const trimmedName = fullName.trim().slice(0, 100);

    const allCodes = await AccessCode.find({});
    let matchedRole = null;
    for (const entry of allCodes) {
      try {
        if (decryptCode(entry.encryptedCode) === trimmedCode) {
          matchedRole = entry.role;
          break;
        }
      } catch (_) {
        // corrupt/undecryptable entry — skip rather than 500 the whole login
      }
    }

    if (!matchedRole) {
      return res.status(401).json({ error: 'Invalid access code' });
    }

    const token = jwt.sign({ fullName: trimmedName, role: matchedRole }, JWT_SECRET, { expiresIn: '8h' });
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 8 * 3600 * 1000,
    });

    return res.json({ fullName: trimmedName, role: matchedRole, token });
  } catch (err) {
    console.error('Access login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// --- Get my own permissions (any authenticated session) ---------------
router.get('/access/permissions', requireAuth, async (req, res) => {
  try {
    const perms = await getPermissionsForRole(req.user.role);
    return res.json({ role: req.user.role, ...perms });
  } catch (err) {
    console.error('Fetch permissions error:', err);
    return res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// --- Admin: view current access codes (decrypted) ----------------------
router.get('/access/codes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roles = ['admin', 'queue_handler', 'associate'];
    const results = {};
    for (const role of roles) {
      const entry = await AccessCode.findOne({ role });
      results[role] = entry ? decryptCode(entry.encryptedCode) : null;
    }
    return res.json({ codes: results });
  } catch (err) {
    console.error('Fetch codes error:', err);
    return res.status(500).json({ error: 'Failed to fetch codes' });
  }
});

// --- Admin: regenerate a role's access code -----------------------------
router.post('/access/codes/:role/regenerate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.params;
    if (!['admin', 'queue_handler', 'associate'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const others = await AccessCode.find({ role: { $ne: role } });
    const otherCodes = others.map((entry) => {
      try { return decryptCode(entry.encryptedCode); } catch (_) { return null; }
    });

    let newCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      if (!otherCodes.includes(candidate)) { newCode = candidate; break; }
    }
    if (!newCode) newCode = generateCode(); // effectively unreachable, but never leave newCode unset

    const encryptedCode = encryptCode(newCode);
    await AccessCode.findOneAndUpdate(
      { role },
      { encryptedCode, updatedAt: new Date(), updatedBy: req.user.fullName },
      { upsert: true }
    );
    return res.json({ role, code: newCode });
  } catch (err) {
    console.error('Regenerate code error:', err);
    return res.status(500).json({ error: 'Failed to regenerate code' });
  }
});

// --- Admin: set a custom access code for a role -------------------------
router.post('/access/codes/:role/set', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.params;
    if (!['admin', 'queue_handler', 'associate'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const { code } = req.body;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Code must be exactly 6 digits' });
    }
    const newCode = code.trim();

    // Prevent two roles from silently sharing the same code — login can
    // only ever resolve to one role per code, so a collision would leave
    // one of them unusable (or worse, granting the wrong role).
    const others = await AccessCode.find({ role: { $ne: role } });
    for (const entry of others) {
      try {
        if (decryptCode(entry.encryptedCode) === newCode) {
          return res.status(409).json({ error: `That code is already in use by ${entry.role}. Choose a different one.` });
        }
      } catch (_) { /* corrupt entry — ignore rather than block */ }
    }

    const encryptedCode = encryptCode(newCode);
    await AccessCode.findOneAndUpdate(
      { role },
      { encryptedCode, updatedAt: new Date(), updatedBy: req.user.fullName },
      { upsert: true }
    );
    return res.json({ role, code: newCode });
  } catch (err) {
    console.error('Set custom code error:', err);
    return res.status(500).json({ error: 'Failed to set code' });
  }
});

// --- Admin: view a role's permission matrix -----------------------------
router.get('/access/permissions/:role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.params;
    if (!['queue_handler', 'associate'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role (admin permissions are fixed and not editable)' });
    }
    const stored = await RolePermission.findOne({ role }).lean();
    const perms = stored || DEFAULT_PERMISSIONS[role];
    return res.json({ role, pages: perms.pages, actions: perms.actions });
  } catch (err) {
    console.error('Fetch role permissions error:', err);
    return res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// --- Admin: update a role's permission matrix ---------------------------
router.put('/access/permissions/:role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.params;
    if (!['queue_handler', 'associate'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role (admin permissions are fixed and not editable)' });
    }
    const { pages, actions } = req.body;

    const cleanPages = {};
    for (const key of PAGE_KEYS) {
      if (key === 'admin') { cleanPages[key] = false; continue; } // never grantable to non-admin
      cleanPages[key] = !!(pages && pages[key]);
    }
    const cleanActions = {};
    for (const key of ACTION_KEYS) {
      cleanActions[key] = !!(actions && actions[key]);
    }

    const updated = await RolePermission.findOneAndUpdate(
      { role },
      { pages: cleanPages, actions: cleanActions, updatedAt: new Date(), updatedBy: req.user.fullName },
      { upsert: true, new: true }
    );
    return res.json({ role, pages: updated.pages, actions: updated.actions });
  } catch (err) {
    console.error('Update role permissions error:', err);
    return res.status(500).json({ error: 'Failed to update permissions' });
  }
});

export default router;

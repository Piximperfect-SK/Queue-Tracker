import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import AccessCode, { encryptCode, decryptCode, generateCode } from '../models/AccessCode.js';
import RolePermission, { DEFAULT_PERMISSIONS, PAGE_KEYS, ACTION_KEYS } from '../models/RolePermission.js';
import Session from '../models/Session.js';
import TwoFactorAuth from '../models/TwoFactorAuth.js';
import { authenticator } from 'otplib';
import bcrypt from 'bcrypt';
import { kickJti, isJtiOnline } from '../realtime.js';
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

async function issueSession(res, fullName, role) {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);
  const token = jwt.sign({ fullName, role, jti }, JWT_SECRET, { expiresIn: '8h' });
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 8 * 3600 * 1000,
  });
  await Session.create({ jti, fullName, role, expiresAt });
  return res.json({ fullName, role, token });
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

    // If this name has 2FA enabled, don't issue a real session yet — issue a
    // short-lived pending token instead, and require /access/login/verify-2fa
    // before a real Session record (and cookie/Bearer token) is created.
    const twoFactor = await TwoFactorAuth.findOne({ fullName: trimmedName, enabled: true });
    if (twoFactor) {
      const pendingToken = jwt.sign(
        { fullName: trimmedName, role: matchedRole, pending2FA: true },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ requiresTwoFactor: true, pendingToken, fullName: trimmedName, role: matchedRole });
    }

    return issueSession(res, trimmedName, matchedRole);
  } catch (err) {
    console.error('Access login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// --- Complete login when 2FA is required --------------------------------
router.post('/access/login/verify-2fa', codeLoginLimiter, async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    if (typeof pendingToken !== 'string' || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing pending token or code' });
    }

    let payload;
    try {
      payload = jwt.verify(pendingToken, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Login session expired. Please log in again.' });
    }
    if (!payload.pending2FA) {
      return res.status(400).json({ error: 'Invalid pending token' });
    }

    const record = await TwoFactorAuth.findOne({ fullName: payload.fullName, enabled: true });
    if (!record) {
      return res.status(400).json({ error: '2FA is no longer enabled for this name' });
    }

    const trimmedCode = code.trim();
    const secret = decryptCode(record.encryptedSecret);
    const validTotp = /^\d{6}$/.test(trimmedCode) && authenticator.verify({ token: trimmedCode, secret });

    let validBackup = false;
    let usedBackupHash = null;
    if (!validTotp) {
      for (const hash of record.backupCodeHashes) {
        if (await bcrypt.compare(trimmedCode.toUpperCase(), hash)) { validBackup = true; usedBackupHash = hash; break; }
      }
    }

    if (!validTotp && !validBackup) {
      return res.status(401).json({ error: 'Incorrect authenticator code' });
    }

    if (validBackup && usedBackupHash) {
      // Backup codes are single-use — burn it now
      record.backupCodeHashes = record.backupCodeHashes.filter((h) => h !== usedBackupHash);
    }
    record.lastUsedAt = new Date();
    await record.save();

    return issueSession(res, payload.fullName, payload.role);
  } catch (err) {
    console.error('2FA login verify error:', err);
    return res.status(500).json({ error: 'Failed to verify code' });
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

// --- Admin: list active sessions ----------------------------------------
router.get('/access/sessions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sessions = await Session.find({ revoked: false, expiresAt: { $gt: new Date() } })
      .sort({ lastSeenAt: -1 })
      .lean();
    const enriched = sessions.map((s) => ({
      jti: s.jti,
      fullName: s.fullName,
      role: s.role,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      lastSeenAt: s.lastSeenAt,
      isOnline: isJtiOnline(s.jti),
      isSelf: req.user.jti === s.jti,
    }));
    return res.json({ sessions: enriched });
  } catch (err) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// --- Admin: kick a session -----------------------------------------------
router.post('/access/sessions/:jti/kick', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { jti } = req.params;
    if (req.user.jti === jti) {
      return res.status(400).json({ error: "Can't kick your own active session — log out normally instead." });
    }
    const session = await Session.findOne({ jti });
    if (!session) {
      return res.status(404).json({ error: 'Session not found (it may have already expired)' });
    }
    session.revoked = true;
    session.revokedAt = new Date();
    session.revokedBy = req.user.fullName;
    await session.save();

    const disconnectedCount = kickJti(jti);
    return res.json({ success: true, wasOnline: disconnectedCount > 0 });
  } catch (err) {
    console.error('Kick session error:', err);
    return res.status(500).json({ error: 'Failed to kick session' });
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

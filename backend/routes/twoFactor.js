import express from 'express';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import TwoFactorAuth from '../models/TwoFactorAuth.js';
import { encryptCode, decryptCode } from '../models/AccessCode.js'; // generic AES helpers, reused here
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin only' });
  }
  return next();
}

function generateBackupCodes(count = 8) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) code += charset[randomBytes(1)[0] % charset.length];
    codes.push(code);
  }
  return codes;
}

// --- Own status -----------------------------------------------------------
router.get('/access/2fa/status', requireAuth, async (req, res) => {
  try {
    const record = await TwoFactorAuth.findOne({ fullName: req.user.fullName });
    return res.json({
      enabled: !!(record && record.enabled),
      pendingSetup: !!(record && !record.enabled),
      backupCodesRemaining: record ? record.backupCodeHashes.length : 0,
    });
  } catch (err) {
    console.error('2FA status error:', err);
    return res.status(500).json({ error: 'Failed to fetch 2FA status' });
  }
});

// --- Begin setup: generate a secret + QR + backup codes -------------------
// Only ever acts on req.user.fullName (the CURRENT authenticated session's
// name) — never a name passed in the request body. This is what prevents
// an unauthenticated request from enrolling 2FA on someone else's name.
router.post('/access/2fa/setup', requireAuth, async (req, res) => {
  try {
    const fullName = req.user.fullName;
    const secret = authenticator.generateSecret();
    const backupCodes = generateBackupCodes();
    const backupCodeHashes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await TwoFactorAuth.findOneAndUpdate(
      { fullName },
      {
        fullName,
        encryptedSecret: encryptCode(secret),
        enabled: false,
        backupCodeHashes,
        createdAt: new Date(),
      },
      { upsert: true }
    );

    const otpauth = authenticator.keyuri(fullName, 'Queue Tracker', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    return res.json({ secret, qrDataUrl, backupCodes });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ error: 'Failed to start 2FA setup' });
  }
});

// --- Confirm setup: prove the app was scanned correctly --------------------
router.post('/access/2fa/confirm', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app' });
    }
    const record = await TwoFactorAuth.findOne({ fullName: req.user.fullName });
    if (!record) {
      return res.status(400).json({ error: 'No pending 2FA setup found. Start setup again.' });
    }
    const secret = decryptCode(record.encryptedSecret);
    const valid = authenticator.verify({ token: code.trim(), secret });
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect code. Check your authenticator app and try again.' });
    }
    record.enabled = true;
    record.enabledAt = new Date();
    record.lastUsedAt = new Date();
    await record.save();
    return res.json({ enabled: true });
  } catch (err) {
    console.error('2FA confirm error:', err);
    return res.status(500).json({ error: 'Failed to confirm 2FA' });
  }
});

// --- Disable (self-service, requires a valid code) -------------------------
router.post('/access/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    const record = await TwoFactorAuth.findOne({ fullName: req.user.fullName, enabled: true });
    if (!record) {
      return res.status(400).json({ error: '2FA is not currently enabled' });
    }
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Enter a code from your authenticator app or a backup code' });
    }
    const trimmed = code.trim();
    const secret = decryptCode(record.encryptedSecret);
    const validTotp = /^\d{6}$/.test(trimmed) && authenticator.verify({ token: trimmed, secret });

    let validBackup = false;
    if (!validTotp) {
      for (const hash of record.backupCodeHashes) {
        if (await bcrypt.compare(trimmed.toUpperCase(), hash)) { validBackup = true; break; }
      }
    }
    if (!validTotp && !validBackup) {
      return res.status(401).json({ error: 'Incorrect code' });
    }
    await TwoFactorAuth.deleteOne({ fullName: req.user.fullName });
    return res.json({ enabled: false });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// --- Admin: list enrollment status for oversight ----------------------------
router.get('/access/2fa/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const records = await TwoFactorAuth.find({}).select('fullName enabled createdAt enabledAt lastUsedAt').lean();
    return res.json({ records });
  } catch (err) {
    console.error('2FA list error:', err);
    return res.status(500).json({ error: 'Failed to load 2FA enrollment list' });
  }
});

// --- Admin: force-reset someone's 2FA (lost phone, account recovery) -------
router.post('/access/2fa/admin-reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { fullName } = req.body;
    if (typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ error: 'fullName is required' });
    }
    const result = await TwoFactorAuth.deleteOne({ fullName: fullName.trim() });
    return res.json({ success: true, removed: result.deletedCount > 0 });
  } catch (err) {
    console.error('2FA admin reset error:', err);
    return res.status(500).json({ error: 'Failed to reset 2FA' });
  }
});

export default router;

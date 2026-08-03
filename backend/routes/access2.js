import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import TwoFactorAuth from '../models/TwoFactorAuth.js';
import PendingUser from '../models/PendingUser.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import SetupSession from '../models/SetupSession.js';
import { requireRole } from '../middleware/requireRole.js';
import { encryptCode, decryptCode } from '../models/AccessCode.js';
import mongoose from 'mongoose';
import { getIo } from '../realtime.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

// Encryption key for pending user secrets.
// Reuse the access-code encryption secret when a dedicated key is not set,
// so production can boot cleanly without a second required secret.
const ENCRYPTION_SECRET = process.env.ENCRYPTION_KEY || process.env.ACCESS_CODE_ENCRYPTION_KEY || (
  process.env.NODE_ENV === 'production'
    ? null
    : crypto.randomBytes(32).toString('hex').slice(0, 32)
);

if (!ENCRYPTION_SECRET) {
  throw new Error('ENCRYPTION_KEY or ACCESS_CODE_ENCRYPTION_KEY must be set in production');
}

const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

function isUnlimitedSessionUser(fullName) {
  return String(fullName || '').trim().toLowerCase() === 'shubham kumar';
}

// Helper function to issue session (same pattern as access.js)
async function issueSession(res, fullName, role) {
  if (!isUnlimitedSessionUser(fullName)) {
    const activeSession = await Session.findOne({
      fullName,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });
    if (activeSession) {
      return res.status(409).json({ error: 'Already Logged on. If want to restore access contact Admin.' });
    }
  }

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
  return { token, fullName, role };
}

// 1. Check if user exists
router.post('/lookup', authLimiter, async (req, res) => {
  try {
    const { fullName } = req.body;
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const cleanName = fullName.trim();

    // Check if active 2FA user
    const existing2FA = await TwoFactorAuth.findOne({ fullName: cleanName, enabled: true });
    if (existing2FA) {
      return res.json({ exists: true, status: 'active' });
    }

    // Check if pending approval
    const pending = await PendingUser.findOne({ fullName: cleanName });
    if (pending) {
      return res.json({ exists: true, status: pending.status });
    }

    // New user
    return res.json({ exists: false });
  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: 'Server error during lookup' });
  }
});

// 2. Existing user login with TOTP
router.post('/login/totp', authLimiter, async (req, res) => {
  try {
    const { fullName, code } = req.body;
    if (!fullName || !code) {
      return res.status(400).json({ error: 'Full name and code are required' });
    }

    const cleanName = fullName.trim();
    const cleanCode = code.trim();

    const auth2FA = await TwoFactorAuth.findOne({ fullName: cleanName, enabled: true });
    if (!auth2FA) {
      return res.status(401).json({ error: 'User not found or 2FA not enabled' });
    }

    // Decrypt the secret
    const secret = decryptCode(auth2FA.encryptedSecret);

    // Verify TOTP code
    const validTotp = /^\d{6}$/.test(cleanCode) && authenticator.verify({
      token: cleanCode,
      secret: secret
    });

    if (!validTotp) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // Update last used timestamp
    auth2FA.lastUsedAt = new Date();
    await auth2FA.save();

    // Determine role: check if admin user, otherwise check approved pending user, default to associate
    let role = 'associate';
    
    // Hardcoded: Shubham Kumar is always admin
    if (cleanName.toLowerCase() === 'shubham kumar') {
      role = 'admin';
    } else {
      const adminUser = await User.findOne({ fullName: cleanName });
      if (adminUser && adminUser.role === 'admin') {
        role = 'admin';
      } else {
        const approvedUser = await PendingUser.findOne({ fullName: cleanName, status: 'approved' });
        if (approvedUser && approvedUser.assignedRole) {
          role = approvedUser.assignedRole;
        }
      }
    }

    // Create session and issue token
    const sessionData = await issueSession(res, cleanName, role);
    if (!sessionData) return;
    
    res.json({
      success: true,
      ...sessionData
    });
  } catch (err) {
    console.error('TOTP login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// 3. New user: start 2FA setup
router.post('/register/setup', authLimiter, async (req, res) => {
  try {
    const { fullName } = req.body;
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const cleanName = fullName.trim();

    // Check if already exists
    const existing = await TwoFactorAuth.findOne({ fullName: cleanName });
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const pending = await PendingUser.findOne({ fullName: cleanName });
    if (pending && pending.status === 'pending') {
      return res.status(400).json({ error: 'Registration already pending approval' });
    }

    // Generate secret
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(cleanName, 'Queue Tracker', secret);

    // Generate QR code
    const qrCodeDataURL = await qrcode.toDataURL(otpauthUrl);

    // Store temporarily in database (auto-expires after 10 minutes)
    await SetupSession.findOneAndUpdate(
      { fullName: cleanName },
      { fullName: cleanName, secret: secret },
      { upsert: true, new: true }
    );

    res.json({
      qrCode: qrCodeDataURL,
      secret: secret
    });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Server error during setup' });
  }
});

// 4. New user: confirm 2FA setup
router.post('/register/confirm', authLimiter, async (req, res) => {
  try {
    const { fullName, code } = req.body;
    if (!fullName || !code) {
      return res.status(400).json({ error: 'Full name and code are required' });
    }

    const cleanName = fullName.trim();
    const cleanCode = code.trim();

    // Get setup data from database
    const setupData = await SetupSession.findOne({ fullName: cleanName });
    if (!setupData) {
      return res.status(400).json({ error: 'Setup session expired. Please start over.' });
    }

    // Verify the code
    const verified = authenticator.verify({
      token: cleanCode,
      secret: setupData.secret
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid code. Please try again.' });
    }

    // Check if user is an admin (auto-approve)
    const adminUser = await User.findOne({ fullName: cleanName });
    const isAdmin = (adminUser && adminUser.role === 'admin') || cleanName.toLowerCase() === 'shubham kumar';

    if (isAdmin) {
      // Auto-approve admin users
      const encryptedSecret = encryptCode(setupData.secret);

      const auth2FA = new TwoFactorAuth({
        fullName: cleanName,
        encryptedSecret: encryptedSecret,
        backupCodeHashes: [],
        enabled: true,
        enabledAt: new Date()
      });
      await auth2FA.save();

      // Create session and issue token
      const sessionData = await issueSession(res, cleanName, 'admin');
      if (!sessionData) return;

      // Clear setup session
      await SetupSession.deleteOne({ fullName: cleanName });

      return res.json({
        success: true,
        autoApproved: true,
        ...sessionData
      });
    }

    // Regular user - create pending approval
    const pendingUser = new PendingUser({
      fullName: cleanName,
      secret: encrypt(setupData.secret),
      backupCodes: [],
      status: 'pending',
      workType: 'voice'
    });
    await pendingUser.save();

    // Clear setup session
    await SetupSession.deleteOne({ fullName: cleanName });

    res.json({
      success: true,
      autoApproved: false,
      message: 'Your registration is pending admin approval'
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server error during confirmation' });
  }
});

// 5. Admin: list pending users
router.get('/pending', requireRole('admin'), async (req, res) => {
  try {
    const pending = await PendingUser.find({ status: 'pending' }).sort({ requestedAt: 1 });
    res.json(pending);
  } catch (err) {
    console.error('List pending error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 6. Admin: approve user
router.post('/pending/:fullName/approve', requireRole('admin'), async (req, res) => {
  try {
    const { fullName: encodedFullName } = req.params;
    const fullName = decodeURIComponent(encodedFullName);
    const { role, workType } = req.body;
    const normalizedWorkType = workType === 'non-voice' ? 'non-voice' : 'voice';

    console.log(`[APPROVE] Processing approval for ${fullName}, role: ${role}`);

    const pending = await PendingUser.findOne({ fullName, status: 'pending' });
    if (!pending) {
      console.log(`[APPROVE] Pending user not found: ${fullName}`);
      return res.status(404).json({ error: 'Pending user not found' });
    }

    try {
      // Decrypt pending data and create TwoFactorAuth with proper encryption
      console.log(`[APPROVE] Attempting to decrypt secret for ${fullName}`);
      const secret = decrypt(pending.secret);
      console.log(`[APPROVE] Secret decrypted successfully`);
      
      console.log(`[APPROVE] Encrypting secret with encryptCode`);
      const encryptedSecret = encryptCode(secret);
      console.log(`[APPROVE] Secret encrypted successfully`);

      // Delete any existing TwoFactorAuth for this user (in case of retry)
      console.log(`[APPROVE] Deleting existing TwoFactorAuth record`);
      await TwoFactorAuth.deleteOne({ fullName: pending.fullName });

      console.log(`[APPROVE] Creating new TwoFactorAuth record`);
      const auth2FA = new TwoFactorAuth({
        fullName: pending.fullName,
        encryptedSecret: encryptedSecret,
        backupCodeHashes: [],
        enabled: true,
        enabledAt: new Date()
      });
      await auth2FA.save();
      console.log(`[APPROVE] Created TwoFactorAuth for ${fullName}`);
    } catch (authErr) {
      console.error(`[APPROVE] Error creating TwoFactorAuth:`, authErr.message, authErr.stack);
      throw authErr;
    }

    // Update pending status
    pending.status = 'approved';
    pending.assignedRole = role || 'associate';
    pending.workType = normalizedWorkType;
    pending.processedAt = new Date();
    pending.processedBy = req.user?.fullName || 'admin';
    await pending.save();

    try {
      const states = mongoose.connection.collection('states');
      const globalState = await states.findOne({ key: 'global' });
      const handlers = Array.isArray(globalState?.handlers) ? globalState.handlers : [];
      const idx = handlers.findIndex((h) => String(h?.name || '').trim().toLowerCase() === fullName.trim().toLowerCase());
      if (idx >= 0) {
        handlers[idx] = { ...handlers[idx], name: handlers[idx].name || fullName, workType: normalizedWorkType };
      } else {
        handlers.push({ id: randomUUID(), name: fullName, isQH: false, workType: normalizedWorkType });
      }
      await states.updateOne({ key: 'global' }, { $set: { handlers } }, { upsert: true });
      const io = getIo();
      if (io) io.emit('handlers_updated', handlers);
    } catch (stateErr) {
      console.error('[APPROVE] Failed to sync handler workType:', stateErr.message);
    }

    console.log(`[APPROVE] Successfully approved ${fullName} as ${role || 'associate'} (${normalizedWorkType})`);
    res.json({ success: true, message: `${fullName} approved as ${role || 'associate'} (${normalizedWorkType})` });
  } catch (err) {
    console.error('[APPROVE] Approval error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error during approval', details: err.message });
  }
});

// 7. Admin: reject user
router.post('/pending/:fullName/reject', requireRole('admin'), async (req, res) => {
  try {
    const { fullName: encodedFullName } = req.params;
    const fullName = decodeURIComponent(encodedFullName);

    const pending = await PendingUser.findOne({ fullName, status: 'pending' });
    if (!pending) {
      return res.status(404).json({ error: 'Pending user not found' });
    }

    pending.status = 'rejected';
    pending.processedAt = new Date();
    pending.processedBy = req.user?.fullName || 'admin';
    await pending.save();

    res.json({ success: true, message: `${fullName} rejected` });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Server error during rejection' });
  }
});

export default router;

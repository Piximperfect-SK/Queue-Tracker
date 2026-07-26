import express from 'express';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import TwoFactorAuth from '../models/TwoFactorAuth.js';
import PendingUser from '../models/PendingUser.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { requireRole } from '../middleware/requireRole.js';
import { encryptCode, decryptCode } from '../models/AccessCode.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

// Encryption key for pending user secrets (use environment variable in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// Helper function to issue session (same pattern as access.js)
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
  return { token, fullName, role };
}

// 1. Check if user exists
router.post('/lookup', async (req, res) => {
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
router.post('/login/totp', async (req, res) => {
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

    // Try TOTP code
    const validTotp = /^\d{6}$/.test(cleanCode) && authenticator.verify({
      token: cleanCode,
      secret: secret
    });

    // If TOTP fails, try backup codes (they're bcrypt hashed)
    let usedBackup = false;
    let usedBackupHash = null;
    if (!validTotp) {
      for (const hash of auth2FA.backupCodeHashes) {
        if (await bcrypt.compare(cleanCode.toUpperCase(), hash)) {
          usedBackup = true;
          usedBackupHash = hash;
          break;
        }
      }
    }

    if (!validTotp && !usedBackup) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // Remove used backup code if applicable
    if (usedBackup && usedBackupHash) {
      auth2FA.backupCodeHashes = auth2FA.backupCodeHashes.filter(h => h !== usedBackupHash);
      auth2FA.lastUsedAt = new Date();
      await auth2FA.save();
    }

    // Determine role: check if admin user, otherwise check approved pending user, default to associate
    let role = 'associate';
    const adminUser = await User.findOne({ fullName: cleanName });
    if (adminUser && adminUser.role === 'Admin') {
      role = 'admin';
    } else {
      const approvedUser = await PendingUser.findOne({ fullName: cleanName, status: 'approved' });
      if (approvedUser && approvedUser.assignedRole) {
        role = approvedUser.assignedRole;
      }
    }

    // Create session and issue token
    const sessionData = await issueSession(res, cleanName, role);
    
    res.json({
      success: true,
      ...sessionData,
      usedBackup
    });
  } catch (err) {
    console.error('TOTP login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// 3. New user: start 2FA setup
router.post('/register/setup', async (req, res) => {
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

    // Generate backup codes (will be bcrypt hashed before storage)
    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    // Generate QR code
    const qrCodeDataURL = await qrcode.toDataURL(otpauthUrl);

    // Store temporarily in session (for confirmation step)
    req.session = req.session || {};
    req.session.pendingSetup = {
      fullName: cleanName,
      secret: secret,
      backupCodes
    };

    res.json({
      qrCode: qrCodeDataURL,
      backupCodes,
      secret: secret
    });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Server error during setup' });
  }
});

// 4. New user: confirm 2FA setup
router.post('/register/confirm', async (req, res) => {
  try {
    const { fullName, code } = req.body;
    if (!fullName || !code) {
      return res.status(400).json({ error: 'Full name and code are required' });
    }

    const cleanName = fullName.trim();
    const cleanCode = code.trim();

    // Get setup data from session
    const setupData = req.session?.pendingSetup;
    if (!setupData || setupData.fullName !== cleanName) {
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
    const isAdmin = adminUser && adminUser.role === 'Admin';

    if (isAdmin) {
      // Auto-approve admin users
      // Encrypt secret and hash backup codes to match existing TwoFactorAuth schema
      const encryptedSecret = encryptCode(setupData.secret);
      const backupCodeHashes = await Promise.all(
        setupData.backupCodes.map(code => bcrypt.hash(code, 10))
      );

      const auth2FA = new TwoFactorAuth({
        fullName: cleanName,
        encryptedSecret: encryptedSecret,
        backupCodeHashes: backupCodeHashes,
        enabled: true,
        enabledAt: new Date()
      });
      await auth2FA.save();

      // Create session and issue token
      const sessionData = await issueSession(res, cleanName, 'admin');

      // Clear setup session
      delete req.session.pendingSetup;

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
      backupCodes: setupData.backupCodes.map(encrypt),
      status: 'pending'
    });
    await pendingUser.save();

    // Clear setup session
    delete req.session.pendingSetup;

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
router.get('/pending', requireRole('Admin'), async (req, res) => {
  try {
    const pending = await PendingUser.find({ status: 'pending' }).sort({ requestedAt: 1 });
    res.json(pending);
  } catch (err) {
    console.error('List pending error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 6. Admin: approve user
router.post('/pending/:fullName/approve', requireRole('Admin'), async (req, res) => {
  try {
    const { fullName } = req.params;
    const { role } = req.body;

    const pending = await PendingUser.findOne({ fullName, status: 'pending' });
    if (!pending) {
      return res.status(404).json({ error: 'Pending user not found' });
    }

    // Decrypt pending data and create TwoFactorAuth with proper encryption
    const secret = decrypt(pending.secret);
    const backupCodes = pending.backupCodes.map(decrypt);
    
    const encryptedSecret = encryptCode(secret);
    const backupCodeHashes = await Promise.all(
      backupCodes.map(code => bcrypt.hash(code, 10))
    );

    const auth2FA = new TwoFactorAuth({
      fullName: pending.fullName,
      encryptedSecret: encryptedSecret,
      backupCodeHashes: backupCodeHashes,
      enabled: true,
      enabledAt: new Date()
    });
    await auth2FA.save();

    // Update pending status
    pending.status = 'approved';
    pending.assignedRole = role || 'Associate';
    pending.processedAt = new Date();
    pending.processedBy = req.session.fullName;
    await pending.save();

    res.json({ success: true, message: `${fullName} approved as ${role || 'Associate'}` });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Server error during approval' });
  }
});

// 7. Admin: reject user
router.post('/pending/:fullName/reject', requireRole('Admin'), async (req, res) => {
  try {
    const { fullName } = req.params;

    const pending = await PendingUser.findOne({ fullName, status: 'pending' });
    if (!pending) {
      return res.status(404).json({ error: 'Pending user not found' });
    }

    pending.status = 'rejected';
    pending.processedAt = new Date();
    pending.processedBy = req.session.fullName;
    await pending.save();

    res.json({ success: true, message: `${fullName} rejected` });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Server error during rejection' });
  }
});

export default router;

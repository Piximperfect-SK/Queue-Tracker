import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';

// Rate limiters (configurable via env)
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_LOGIN_WINDOW_MS || '300000', 10), // 5min
  max: parseInt(process.env.AUTH_LOGIN_MAX || '3', 10), // default: 3 attempts
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_REGISTER_WINDOW_MS || '3600000', 10), // 1hr
  max: parseInt(process.env.AUTH_REGISTER_MAX || '3', 10),
  message: { error: 'Too many registrations from this IP. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const REGISTRATION_SECRET = (process.env.REGISTRATION_SECRET || '').trim();

// Helpers
function makeToken(user) {
  const payload = { userId: user._id.toString(), username: user.username, role: user.role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// Register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, fullName, password, registrationSecret } = req.body;

    if (!username || !fullName || !password || !registrationSecret) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify registration secret
    if (!REGISTRATION_SECRET || registrationSecret !== REGISTRATION_SECRET) {
      return res.status(403).json({ error: 'Invalid registration code' });
    }

    const cleanUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_\-\.]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }

    if (!validator.isLength(password, { min: 8 })) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ username: cleanUsername, fullName: fullName.trim(), passwordHash: hash });

    // Optionally create token on registration and set cookie
    const token = makeToken(user);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });

    return res.status(201).json({ message: 'Registered', user: { username: user.username, fullName: user.fullName, role: user.role } });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

    const cleanUsername = username.toLowerCase().trim();
    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      // Increment failed attempts (for monitoring) but do NOT lock the account
      await User.updateOne({ _id: user._id }, { $inc: { failedLogins: 1 } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed logins and set last login
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lastLoginAt: new Date() } });

    const token = makeToken(user);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });

    return res.json({ message: 'OK', user: { username: user.username, fullName: user.fullName, role: user.role } });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ message: 'Logged out' });
});

// Who am I
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.token || (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ error: 'Unauthorized' }); }
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user });
  } catch (err) {
    console.error('/me error', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

export default router;

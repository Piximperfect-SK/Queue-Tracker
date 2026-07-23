// backend/routes/auth.js
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';

const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_LOGIN_WINDOW_MS || '300000', 10),
  max: parseInt(process.env.AUTH_LOGIN_MAX || '10', 10), // raised from 3 — too aggressive for prod
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for the same IP if they already have a valid session
  skip: (req) => !!req.cookies?.token,
});

const registerLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_REGISTER_WINDOW_MS || '3600000', 10),
  max: parseInt(process.env.AUTH_REGISTER_MAX || '5', 10),
  message: { error: 'Too many registrations from this IP. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const REGISTRATION_SECRET = (process.env.REGISTRATION_SECRET || '').trim();

function makeToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    // KEY FIX: 'none' allows cross-site requests (Netlify → Render)
    // Must pair with secure: true in production
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 8 * 3600 * 1000,
  };
}

// Register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, fullName, password, registrationSecret } = req.body;
    if (!username || !fullName || !password || !registrationSecret)
      return res.status(400).json({ error: 'Missing required fields' });

    if (!REGISTRATION_SECRET || registrationSecret !== REGISTRATION_SECRET)
      return res.status(403).json({ error: 'Invalid registration code' });

    const cleanUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_\-\.]{3,30}$/.test(cleanUsername))
      return res.status(400).json({ error: 'Invalid username format' });

    if (!validator.isLength(password, { min: 8 }))
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      username: cleanUsername,
      fullName: fullName.trim(),
      passwordHash: hash,
    });

    const token = makeToken(user);
    res.cookie('token', token, cookieOptions());
    return res.status(201).json({
      message: 'Registered',
      user: { username: user.username, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Missing username or password' });

    const cleanUsername = username.toLowerCase().trim();
    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await User.updateOne({ _id: user._id }, { $inc: { failedLogins: 1 } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { failedLogins: 0, lastLoginAt: new Date() } }
    );

    const token = makeToken(user);
    res.cookie('token', token, cookieOptions());
    return res.json({
      message: 'OK',
      user: { username: user.username, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', cookieOptions());
  return res.json({ message: 'Logged out' });
});

// /me
router.get('/me', async (req, res) => {
  try {
    const token =
      req.cookies?.token ||
      (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user });
  } catch (err) {
    console.error('/me error', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

export default router;

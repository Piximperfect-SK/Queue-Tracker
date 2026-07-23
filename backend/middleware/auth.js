import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

export async function optionalAuth(socketOrReq, next) {
  // For sockets we attach to socket, for http we attach to req
  const token = (socketOrReq.handshake && socketOrReq.handshake.auth && socketOrReq.handshake.auth.token) ||
    (socketOrReq.headers && socketOrReq.headers.cookie && (socketOrReq.headers.cookie.match(/token=([^;]+)/) || [])[1]) ||
    (socketOrReq.cookies && socketOrReq.cookies.token) ||
    (socketOrReq.header && socketOrReq.header('Authorization') && socketOrReq.header('Authorization').replace(/^Bearer\s+/i, ''));

  if (!token) return next(); // no auth, proceed but unauthenticated

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (user) {
      socketOrReq.user = user;
    }
  } catch (err) {
    // ignore invalid tokens
  }
  return next();
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.token || (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

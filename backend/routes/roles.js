import express from 'express';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

// Helper to extract user from JWT cookie or Authorization header
function extractUser(req) {
  const token = req.cookies?.token || (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// GET /api/roles — return all users with roles (admin only)
router.get('/roles', async (req, res) => {
  const user = extractUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  
  // Only admins can view all roles
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const users = await User.find({}).select('fullName username role isActive');
    return res.json({ users });
  } catch (err) {
    console.error('Error fetching roles:', err);
    return res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// PUT /api/roles — update a user's role (admin only)
router.put('/roles', async (req, res) => {
  const user = extractUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { userId, role } = req.body;
  if (!userId || !role) {
    return res.status(400).json({ error: 'Missing userId or role' });
  }

  const validRoles = ['admin', 'queue_handler', 'associate'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent demoting the last admin
    if (targetUser.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last admin' });
      }
    }

    targetUser.role = role;
    await targetUser.save();

    return res.json({ message: 'Role updated', user: { fullName: targetUser.fullName, username: targetUser.username, role: targetUser.role } });
  } catch (err) {
    console.error('Error updating role:', err);
    return res.status(500).json({ error: 'Failed to update role' });
  }
});

export default router;
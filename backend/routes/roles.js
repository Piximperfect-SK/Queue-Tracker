import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import { getIo } from '../realtime.js';

import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/roles — return all users with roles (admin only)
router.get('/roles', requireAuth, async (req, res) => {
  // Only admins can view all roles
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const users = await User.find({}).select('fullName username role workType isActive');
    return res.json({ users });
  } catch (err) {
    console.error('Error fetching roles:', err);
    return res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// PUT /api/roles — update a user's role (admin only)
router.put('/roles', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { userId, role, workType } = req.body;
  if (!userId || !role) {
    return res.status(400).json({ error: 'Missing userId or role' });
  }

  const validRoles = ['admin', 'queue_handler', 'associate'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }
  const normalizedWorkType = workType === 'non-voice' ? 'non-voice' : 'voice';

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
    targetUser.workType = normalizedWorkType;
    await targetUser.save();

    try {
      const states = mongoose.connection.collection('states');
      const globalState = await states.findOne({ key: 'global' });
      const handlers = Array.isArray(globalState?.handlers) ? globalState.handlers : [];
      const idx = handlers.findIndex((h) => String(h?.name || '').trim().toLowerCase() === targetUser.fullName.trim().toLowerCase());
      if (idx >= 0) {
        handlers[idx] = {
          ...handlers[idx],
          name: handlers[idx].name || targetUser.fullName,
          workType: normalizedWorkType,
        };
        await states.updateOne({ key: 'global' }, { $set: { handlers } }, { upsert: true });
        const io = getIo();
        if (io) io.emit('handlers_updated', handlers);
      }
    } catch (stateErr) {
      console.error('Error syncing handler workType after role update:', stateErr);
    }

    return res.json({ message: 'Role updated', user: { fullName: targetUser.fullName, username: targetUser.username, role: targetUser.role, workType: targetUser.workType } });
  } catch (err) {
    console.error('Error updating role:', err);
    return res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/roles/:userId — delete a user (admin only)
router.delete('/roles/:userId', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting the last admin
    if (targetUser.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
      }
    }

    // Don't allow deleting yourself
    const requestingUserId = (req.user._id || req.user.userId)?.toString();
    if (requestingUserId === targetUser._id.toString()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Also check fullName if it's a session-based pseudo-user from access codes
    if (!requestingUserId && req.user.fullName === targetUser.fullName) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await User.findByIdAndDelete(userId);

    return res.json({ message: 'User deleted successfully', userId });
  } catch (err) {
    console.error('Error deleting user:', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
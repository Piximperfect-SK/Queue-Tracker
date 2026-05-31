import express from 'express';
import User from '../models/User.js';

const router = express.Router();

/**
 * GET /api/get-role-by-name?name=Shubham%20Kumar
 * Look up a user's role by their full name (case-insensitive).
 * This bridges the socket-based auth flow with the JWT account system.
 */
router.get('/get-role-by-name', async (req, res) => {
  try {
    const fullName = req.query.name;
    if (!fullName) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Case-insensitive search
    const user = await User.findOne({
      fullName: { $regex: new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (user) {
      return res.json({ role: user.role });
    }

    // Default to 'associate' if no account found
    return res.json({ role: 'associate' });
  } catch (err) {
    console.error('Error looking up role:', err);
    return res.status(500).json({ error: 'Failed to look up role' });
  }
});

export default router;
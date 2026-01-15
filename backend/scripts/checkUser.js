import mongoose from 'mongoose';
import 'dotenv/config';
import User from '../models/User.js';

const uri = process.env.MONGODB_URI;
const username = (process.env.ADMIN_USERNAME || '').toLowerCase();

if (!uri || !username) {
  console.error('Provide MONGODB_URI and ADMIN_USERNAME env vars');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(uri);
    const u = await User.findOne({ username }).select('-passwordHash -__v').lean();
    if (!u) {
      console.log('User not found');
      process.exit(2);
    }
    console.log('User found:', JSON.stringify(u, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();

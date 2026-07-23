import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import 'dotenv/config';
import User from '../models/User.js';

const MONGODB_URI = process.env.MONGODB_URI;
const username = (process.env.ADMIN_USERNAME || '').toLowerCase();
const NEW_PWD = process.env.NEW_ADMIN_PWD;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

if (!MONGODB_URI || !username || !NEW_PWD) {
  console.error('Usage: set envs MONGODB_URI, ADMIN_USERNAME, NEW_ADMIN_PWD');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    const user = await User.findOne({ username });
    if (!user) {
      console.error('Admin user not found');
      process.exit(2);
    }
    const hash = await bcrypt.hash(NEW_PWD, BCRYPT_ROUNDS);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: hash } });
    console.log('Admin password updated successfully for user', username);
    process.exit(0);
  } catch (err) {
    console.error('Error updating admin password:', err.message);
    process.exit(1);
  }
})();
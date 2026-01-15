import mongoose from 'mongoose';
import 'dotenv/config';
import bcrypt from 'bcrypt';
import User from '../models/User.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/queue_tracker';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PWD = process.env.ADMIN_PWD;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const run = async () => {
  if (!ADMIN_USERNAME || !ADMIN_PWD) {
    console.log('ADMIN_USERNAME or ADMIN_PWD not set; skipping admin seed.');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  const existing = await User.findOne({ username: ADMIN_USERNAME.toLowerCase() });
  if (existing) {
    console.log('Admin already exists.');
    process.exit(0);
  }

  const hash = await bcrypt.hash(ADMIN_PWD, BCRYPT_ROUNDS);
  await User.create({ username: ADMIN_USERNAME.toLowerCase(), fullName: 'Admin', passwordHash: hash, role: 'admin' });
  console.log('Admin user created.');
  process.exit(0);
};

run().catch(err => { console.error(err); process.exit(1); });

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  fullName: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['handler','admin','auditor'], default: 'handler' },
  isActive: { type: Boolean, default: true },
  failedLogins: { type: Number, default: 0 },
  lastLoginAt: Date,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.User || mongoose.model('User', userSchema);

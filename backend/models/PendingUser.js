import mongoose from 'mongoose';

const pendingUserSchema = new mongoose.Schema({
  fullName: { type: String, required: true, unique: true },
  secret: { type: String, required: true }, // encrypted with AES
  backupCodes: [{ type: String }], // encrypted
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  assignedRole: { type: String, default: 'Associate' },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: String } // admin fullName
});

export default mongoose.model('PendingUser', pendingUserSchema);

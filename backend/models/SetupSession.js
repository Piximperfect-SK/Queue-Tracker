import mongoose from 'mongoose';

const setupSessionSchema = new mongoose.Schema({
  fullName: { type: String, required: true, unique: true },
  secret: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 } // Auto-delete after 10 minutes
});

export default mongoose.model('SetupSession', setupSessionSchema);

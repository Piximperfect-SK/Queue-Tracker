import mongoose from 'mongoose';

// Keyed by fullName rather than a real account, since this app has no
// individually-authenticated identity beyond "knows the shared role code +
// typed this name". This is a deliberate, known limitation: enabling 2FA is
// only ever allowed from within an already-authenticated session (using
// req.user.fullName from a valid JWT, never an arbitrary request body name)
// — see routes/twoFactor.js. That stops the most obvious hijack (a stranger
// enabling/disabling 2FA on someone else's name from an unauthenticated
// request), but doesn't fully close the gap: because login itself only
// requires the shared code + typing a name, someone could still log in
// AS you (if they have the code) and enroll 2FA on your name before you do,
// effectively locking you out. Admin has a reset path for exactly this.
const twoFactorSchema = new mongoose.Schema({
  fullName: { type: String, required: true, unique: true, trim: true },
  encryptedSecret: { type: String, required: true },
  enabled: { type: Boolean, default: false }, // false until confirmed with a valid code
  backupCodeHashes: [{ type: String }], // bcrypt-hashed, single-use
  createdAt: { type: Date, default: Date.now },
  enabledAt: { type: Date },
  lastUsedAt: { type: Date },
});

export default mongoose.models.TwoFactorAuth || mongoose.model('TwoFactorAuth', twoFactorSchema);

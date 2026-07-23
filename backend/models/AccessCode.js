import mongoose from 'mongoose';
import crypto from 'crypto';

// Codes are stored encrypted (reversible) rather than hashed, because Admin
// needs to be able to VIEW the current code at any time from the app, not
// just regenerate it blind. This is a deliberate tradeoff: anyone with DB +
// ENCRYPTION_KEY access could decrypt these, so treat ENCRYPTION_KEY with the
// same care as JWT_SECRET (never commit it, rotate if ever exposed).

const ALGO = 'aes-256-gcm';

function getKey() {
  const key = process.env.ACCESS_CODE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('ACCESS_CODE_ENCRYPTION_KEY must be set to a string of at least 32 characters');
  }
  // Derive a 32-byte key regardless of the provided secret's exact length
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptCode(plainCode) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainCode, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptCode(stored) {
  const [ivHex, authTagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateCode() {
  // 6-digit numeric PIN — easy to remember/type. Brute-force resistance comes
  // from rate limiting (see routes/access.js: 5 attempts / 15 min per IP),
  // not from code length — 1,000,000 combinations at that rate takes years
  // to exhaust from a single source.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

const accessCodeSchema = new mongoose.Schema({
  role: { type: String, enum: ['admin', 'queue_handler', 'associate'], required: true, unique: true },
  encryptedCode: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String }, // fullName of the admin who last generated/changed it
});

export default mongoose.models.AccessCode || mongoose.model('AccessCode', accessCodeSchema);

import mongoose from 'mongoose';

// JWTs are stateless by design — once issued, they're normally valid until
// they expire, with no way to revoke one early. This collection is what
// makes "kick this user" possible: every login creates a Session record
// keyed by a unique jti (embedded in the JWT itself), and every
// authenticated request/socket connection checks it. Revoking a session
// here makes the token functionally dead everywhere, immediately, even
// though the JWT itself remains cryptographically valid until its natural
// expiry.
//
// The TTL index auto-deletes expired session records so this collection
// doesn't grow unbounded — Mongo handles cleanup, nothing to schedule.
const sessionSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  role: { type: String, enum: ['admin', 'queue_handler', 'associate'], required: true },
  issuedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, default: Date.now },
  revoked: { type: Boolean, default: false },
  revokedAt: { type: Date },
  revokedBy: { type: String },
});

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Session || mongoose.model('Session', sessionSchema);

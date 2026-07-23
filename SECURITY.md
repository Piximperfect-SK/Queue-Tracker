# Security Overview ✅

This document summarizes the security measures implemented across the Queue Tracker project. It references code locations and describes the purpose and effect of each control. It also includes short recommendations for further hardening.

---

## 1) Environment & Secrets 🔑

- Uses environment variables (via `dotenv`) to store secrets and environment-specific values:
  - `MONGODB_URI` (backend) — database connection string
  - `FRONTEND_URL`, `ALLOWED_ORIGINS` — CORS whitelist
  - `TEAM_ACCESS_KEY` — optional join/access key for socket-based joins
  - MSAL variables in frontend: `VITE_MS_CLIENT_ID`, `VITE_MS_TENANT_ID`

Files: `backend/server.js`, `.env` usage

**Why:** Keeps sensitive data out of source control and enables secret rotation per environment.

---

## 2) CORS Policy & Origin Restriction 🌐

- Strict CORS handling implemented in `backend/server.js`:
  - Accepts localhost by default
  - Accepts origins listed in `ALLOWED_ORIGINS` or `FRONTEND_URL`
  - Includes an emergency "*" option if intentionally set
  - Limits allowed methods to `GET` and `POST`
  - `credentials: true` is set when relevant

Files: `backend/server.js`

**Why:** Prevents unauthorized cross-origin requests from untrusted origins.

---

## 3) Rate Limiting (HTTP & Socket) ⏱️

- HTTP rate limiting using `express-rate-limit` (15 min window, max 100 requests):
  - Configured with `standardHeaders: true` and `legacyHeaders: false` to expose standard headers.
  - Excludes the socket.io handshake path from HTTP rate-limiter.
- Socket-level throttling:
  - A per-socket event counter resets periodically and blocks clients sending >20 events/sec.

Files: `backend/server.js`

**Why:** Mitigates brute-force, DoS, and high-frequency abuse.

---

## 4) Input Sanitization & Validation 🧼

- A simple server-side sanitizer strips HTML tags from strings before storing or broadcasting:
  - `sanitize()` used for usernames, handler names, and log details.
- All data mutations (handlers, roster, stats, logs) go through server-side sanitization before persistence.

Files: `backend/server.js`

**Why:** Reduces risk of stored/reflective XSS and injection via loosely typed inputs from clients.

---

## 5) Access Control & Authentication Checks 🔐

- Optional Team Access Key:
  - If `TEAM_ACCESS_KEY` is set, `join` socket event validates the provided key and denies access if incorrect.
- Client-side measures:
  - Authentication gating in `frontend/src/App.tsx`: forces logout if name is missing or reserved (`Guest`).
  - Security-key input uses `type="password"` to prevent exposure in UI.
- MSAL (Microsoft Identity / Azure AD) support available in frontend (`@azure/msal-browser`):
  - Configured to use `sessionStorage` for auth caching to minimize persistent storage of tokens.

Files: `backend/server.js`, `frontend/src/App.tsx`, `frontend/src/authConfig.ts`

**Why:** Limits access to authorized users and provides integration with an identity provider.

---

## 6) Audit Logging & Safe Exports 📋

- Actions are logged to a MongoDB `Log` collection with `dateStr` and `timestamp`.
- Export endpoints for logs:
  - `/download-logs/:date` and `/download-all-logs` return `text/plain` files with `Content-Disposition` headers.
- Local client-side logs are kept in `localStorage` for offline/UX reasons, but server remains the authoritative source.

Files: `backend/server.js`, `frontend/src/utils/logger.ts`

**Why:** Provides an audit trail and safe export mechanism for incident response and compliance.

---

## 7) Safe Defaults & Operational Safety ⚙️

- Health endpoint at `/health` for monitoring.
- Migration safeguards in `migrateData()`:
  - Prevents double-migration by renaming the source file after migration.
- Use of `dotenv` to enable environment-specific behavior and avoid hardcoding.

Files: `backend/server.js`

**Why:** Improves operational safety and reduces accidental data loss.

---

## 8) Logging Hygiene & Privacy 🕵️‍♂️

- Logger on the frontend avoids logging PII from the MSAL library (`containsPii` is ignored).
- Server prints masked status for sensitive items (e.g., whether `TEAM_ACCESS_KEY` is set) rather than the raw value.

Files: `frontend/src/authConfig.ts`, `backend/server.js`

**Why:** Helps ensure sensitive values are not accidentally leaked to logs.

---

## Recommendations / Known Gaps (Next Steps) 💡

While the project already includes several strong controls, consider these additional hardening steps:

- Enforce HTTPS/TLS for all endpoints and Socket connections (use secure WSS). 🔒
- Add HTTP security headers (e.g., via `helmet`) and a Content Security Policy (CSP). 🛡️
- Add CSRF protection for any non-idempotent HTTP endpoints (if later added). 🔐
- Protect log download endpoints with authenticated access and authorization checks (role-based). 🔐
- Use stronger, well-tested input validation libraries (e.g., `validator.js`, `zod`) and stricter schema validation. ✅
- Consider rotating secrets and adding secret management (e.g., Vault, Azure Key Vault). 🔁
- Avoid storing sensitive tokens or credentials in `localStorage`; prefer in-memory or secure cookies when possible. 🧰
- Add vulnerability scanning (Snyk/Dependabot) and CI policy for dependency upgrades. 🔍

---

## New Auth Environment Variables

- `JWT_SECRET` — Secret used to sign session JWT tokens. **Required** in production.
- `REGISTRATION_SECRET` — Registration code used to authorize sign-ups. Set this to a strong value.
- `BCRYPT_ROUNDS` — Number of bcrypt rounds when hashing passwords (default: 12).
- `ADMIN_USERNAME`, `ADMIN_PWD` — Optional env vars used by `scripts/seedAdmin.js` to create an initial admin user.
- `ENFORCE_LOG_DOWNLOAD_AUTH` — Set to `true` to require admin auth for log downloads (default: `false` to avoid breaking existing systems during rollout).

---

## Quick References (files / lines)

- Backend:
  - `backend/server.js` — Rate limiting, CORS, socket rate limiting, sanitization, TEAM_ACCESS_KEY, migration, health, log export
  - `backend/package.json` — dependencies: `express-rate-limit`, `cors`, `mongoose`, `socket.io`, `dotenv`
- Frontend:
  - `frontend/src/authConfig.ts` — MSAL / sessionStorage config
  - `frontend/src/App.tsx` — client-side auth gating / input handling
  - `frontend/src/utils/socket.ts` — socket client configuration
  - `frontend/src/utils/logger.ts` — client logging & log download

---

If you'd like, I can:
- Generate a checklist for a security review or audit ✅
- Add a CI job that runs dependency checks and linting for security-related rules ✅


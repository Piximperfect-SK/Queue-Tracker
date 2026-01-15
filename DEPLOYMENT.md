# Deployment & Secrets (Queue Tracker)

This document explains how to deploy the backend (Node/Express) and configure secrets on Netlify or Render, and how to set up MongoDB Atlas.

## Required environment variables (minimum)
- MONGODB_URI — MongoDB connection string (Atlas recommended)
- JWT_SECRET — Strong secret (>= 32 bytes recommended)
- REGISTRATION_SECRET — Code required for user registrations
- AUTH_LOGIN_MAX — Max login attempts (default 3)
- BCRYPT_ROUNDS — Optional (default 12)
- FRONTEND_URL — Frontend URL used for CORS (e.g., https://app.example.com)

## Netlify (if used for backend functions)
Netlify is primarily for static sites and serverless functions. For a full Node backend use Render or other VPS. If using Netlify functions:
- Use Netlify environment variables (Site settings → Build & deploy → Environment)
- Add values for `JWT_SECRET`, `MONGODB_URI`, `REGISTRATION_SECRET`.
- Ensure functions are deployed with sufficient memory and set `NODE_ENV=production`.

## Render (recommended for Node backend)
- Create a new Web Service on Render and set the Start Command: `node server.js`.
- In the service > Environment > Environment Variables, set:
  - `MONGODB_URI` (Atlas connection string)
  - `JWT_SECRET` (use strong, rotated secret)
  - `REGISTRATION_SECRET` (the registration code)
  - `NODE_ENV=production`
- Configure health checks on `/health` and specify port `3001`.

## MongoDB Atlas
- Create a project and cluster, create a database user with a strong password.
- Whitelist the Render/Netlify IPs (or enable access from anywhere temporarily per your policies).
- Use the provided SRV connection string as `MONGODB_URI`.
- For production, enable encryption at rest and role-based access.

## Security best practices for Live
1. **Secrets management**: store `JWT_SECRET`, DB creds, and admin credentials in a secrets manager (Render env vars or a secrets vault). Rotate regularly.
2. **HTTPS**: ensure TLS is used end-to-end; set cookie `secure: true` in production.
3. **Token strategy**: use short-lived access tokens + refresh tokens with server-side revocation/rotation.
4. **MFA**: enable MFA for admin accounts.
5. **Monitoring**: set up alerts for failed logins spikes and repeated registrations.
6. **CI/CD**: run auth smoke tests (we added a GitHub Actions workflow) against a test cluster before merges.

## Updating secrets after rotation
- Update the secret in Render (or Netlify) environment variables. Restart the service after changing secrets.
- For `JWT_SECRET` rotation, a short overlap with old tokens may be needed or implement refresh token revocation.

If you'd like, I can add specific Render / Netlify screenshots or automation steps (e.g., a script to upload secrets to Render/Netlify via CLI).
# New Authentication Flow Implementation Summary

## Overview
Implemented a new 2FA-first authentication system that removes access codes from the login flow and replaces it with a multi-stage approval process.

## Backend Changes

### New Model: PendingUser.js
- Stores new user 2FA setup information pending admin approval
- Fields: fullName, encrypted secret, encrypted backup codes, status (pending/approved/rejected), assignedRole, timestamps

### New Routes: access2.js
All routes under `/api/access/`:

1. **POST /lookup** - Check if a full name exists in the system
   - Returns: `{exists: true/false, status: 'active'|'pending'|'rejected'}`

2. **POST /login/totp** - Existing user login with name + TOTP code
   - No access code required
   - Supports backup codes
   - Issues JWT session token

3. **POST /register/setup** - New user starts 2FA setup
   - Generates QR code and 8 backup codes
   - Stores temporarily in session

4. **POST /register/confirm** - New user confirms 2FA scan
   - Verifies code works
   - Auto-approves admins (checks User model)
   - Creates pending approval for regular users

5. **GET /pending** - Admin lists pending users (requires Admin role)

6. **POST /pending/:fullName/approve** - Admin approves user with role assignment

7. **POST /pending/:fullName/reject** - Admin rejects user

### Server Integration
- Registered new routes in `server.js` under `/api/access`
- Uses `otplib` for TOTP generation/verification (already installed)

## Frontend Changes

### App.tsx - Complete Auth Flow Rewrite

**New State:**
```typescript
authStage: 'name' | 'totp' | 'setup-qr' | 'setup-confirm' | 'pending' | 'rejected'
inputName, inputCode, setupQR, backupCodes, setupSecret
```

**New Handlers:**
- `handleNameLookup()` - Submits name, determines next stage based on user status
- `handleTotpLogin()` - Existing user enters TOTP code
- `handleSetupConfirm()` - New user confirms QR scan worked

**UI Stages:**
1. **name** - Enter full name
2. **totp** - Existing user: enter authenticator code
3. **setup-qr** - New user: displays QR code and backup codes to save
4. **setup-confirm** - New user: enter code to prove setup worked
5. **pending** - Waiting for admin approval message
6. **rejected** - Access denied message

### AdminPage.tsx - Pending Approvals Tab

**New State:**
```typescript
pendingUsers: PendingUserRecord[]
approvingUser, rejectingUser: string | null
selectedRole: Record<string, Role>
```

**New Tab:**
- **User Approvals** (default tab, shown first)
- Badge shows pending count
- Each pending user card shows:
  - Full name
  - Time since request
  - Role dropdown (Associate/Queue Handler/Admin)
  - Approve (green) and Reject (red) buttons with loading states
- Empty state when no pending requests

## Bootstrap Process

Admin accounts (checked via User model) are **auto-approved** when they complete 2FA setup - no chicken-and-egg problem.

## Security Notes

1. Secrets stored encrypted in PendingUser model using AES-256-CBC
2. Backup codes also encrypted
3. Session management unchanged - still uses JWT tokens
4. TOTP uses standard 6-digit codes with 30-second window
5. Backup codes are one-time use (removed after use)

## Migration Path

Old access code login route (`/api/access/login`) still exists and works for backward compatibility. The new system operates in parallel on `/api/access/*` routes.

## Testing Checklist

- [ ] Admin can complete 2FA setup and auto-approve themselves
- [ ] New regular user can set up 2FA and sees pending approval message
- [ ] Admin can see pending users in Admin Panel → User Approvals
- [ ] Admin can approve users with role assignment
- [ ] Admin can reject users
- [ ] Existing approved users can log in with name + TOTP code
- [ ] Backup codes work as alternative to TOTP
- [ ] Rejected users see appropriate message
- [ ] Build completes without errors ✓

## Files Modified/Created

**Backend:**
- `backend/models/PendingUser.js` (new)
- `backend/routes/access2.js` (new)
- `backend/server.js` (registered new routes)

**Frontend:**
- `frontend/src/App.tsx` (complete auth UI rewrite)
- `frontend/src/pages/AdminPage.tsx` (added pending approvals tab)

Build Status: ✅ Frontend builds successfully (9.6s, no errors)

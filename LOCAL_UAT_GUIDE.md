# Local UAT Testing Guide

This guide helps you test changes locally before pushing to main and deploying to production.

## Prerequisites

1. **MongoDB**: Choose one option:
   - **Option A (Recommended)**: Use your production MongoDB Atlas URI in `backend/.env`
   - **Option B**: Install MongoDB locally and use local database

2. **Node.js**: Already installed (v24.15.0)

## Setup Steps

### 1. Configure Backend Environment

Edit `backend/.env` if needed:
- **JWT_SECRET**: Keep as-is for local testing, or use a strong random string
- **ACCESS_CODE_ENCRYPTION_KEY**: Keep as-is for local testing
- **ENCRYPTION_KEY**: Keep as-is for local testing
- **MONGODB_URI**: 
  - If testing with production data: Use your MongoDB Atlas connection string
  - If testing with local MongoDB: Use `mongodb://localhost:27017/queue_tracker_dev`

### 2. Frontend is Already Configured

The `frontend/.env.local` file has been created and points to `http://localhost:3001`

### 3. Start Backend Server

```powershell
cd backend
npm run dev
```

The backend will:
- Connect to MongoDB
- Seed admin user if not exists
- Seed access codes
- Listen on port 3001

### 4. Start Frontend Server (in a new terminal)

```powershell
cd frontend
npm run dev
```

The frontend will:
- Start Vite dev server (usually port 5173)
- Proxy API calls to http://localhost:3001

### 5. Test Your Changes

1. Open browser to the URL shown by Vite (e.g., `http://localhost:5173`)
2. Test the new 2FA authentication flow:
   - Enter a full name
   - **Existing user**: Enter TOTP code
   - **New user**: Scan QR code, confirm setup, wait for admin approval
3. Test admin approval workflow (Admin page → User Approvals tab)
4. Verify all features work as expected

## Testing Checklist

- [ ] New user registration with 2FA setup
- [ ] QR code displays correctly
- [ ] Backup codes are shown and can be copied
- [ ] Admin approval workflow
- [ ] Existing user TOTP login
- [ ] Backup code login (if TOTP fails)
- [ ] Role-based access (admin vs queue_handler vs associate)
- [ ] All pages load correctly after authentication

## When Ready to Deploy

Once local UAT passes:

```powershell
git add .
git commit -m "Your changes description"
git push origin main
```

This will trigger:
- **Render**: Redeploys backend
- **Netlify**: Redeploys frontend
- **MongoDB**: Production database (already configured)

## Troubleshooting

### Backend won't start
- Check MongoDB connection in `backend/.env`
- Ensure port 3001 is not in use
- Check for missing dependencies: `npm install`

### Frontend can't connect to backend
- Verify backend is running on port 3001
- Check `frontend/.env.local` has correct URL
- Check browser console for CORS errors

### 2FA not working
- Verify `ACCESS_CODE_ENCRYPTION_KEY` is set in backend/.env
- Check backend console for encryption errors
- Ensure TwoFactorAuth model has encrypted secrets

### Database errors
- If using local MongoDB: Ensure MongoDB service is running
- If using Atlas: Check connection string and network access
- Check backend console for specific error messages

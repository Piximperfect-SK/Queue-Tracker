# Queue Tracker

A real-time productivity queue management system with role-based access control, roster management, daily tracking, and audit logging.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript, Vite, Tailwind CSS v4 |
| **Backend** | Node.js, Express 5 |
| **Database** | MongoDB + Mongoose |
| **Real-time** | Socket.IO (WebSocket + polling fallback) |
| **Auth** | JWT (httpOnly cookie + Bearer token), bcrypt |
| **Charts** | Recharts |
| **Drag & Drop** | @dnd-kit |

## Features

- **Access Code Login** — Users log in with a 6-digit PIN that determines their role server-side. Brute-force resistant via rate limiting.
- **Role-Based Permissions** — Granular page and action-level permissions configurable per role. Permissions can be customized in real time.
- **Roster Management** — Create/edit handlers (agents), assign shifts, manage daily rosters with drag-and-drop support.
- **Daily Tracker** — Log incidents, SC tasks, and calls per handler per day with comments.
- **Audit Logging** — Every action is timestamped and stored server-side in MongoDB. Live log monitor page with connection/API health dashboard.
- **Live Presence** — See who's online in real time; socket-level rate limiting (max 20 events/sec per socket).
- **Admin Panel** — View/change user roles, regenerate access codes, and configure permission matrices.
- **Log Export** — Download daily or full audit logs as plain text files.
- **CSRF Protection** — Double-submit cookie pattern via csurf for state-changing HTTP endpoints.
- **Input Sanitization** — HTML tag stripping on all user-supplied text before storage/transmission.

## Project Structure

```
queue-tracker/
├── backend/
│   ├── server.js                # Express + Socket.IO main server
│   ├── middleware/
│   │   ├── auth.js              # JWT verification
│   │   └── permissions.js       # Role-based permission checks
│   ├── models/
│   │   ├── User.js              # User schema
│   │   ├── AccessCode.js        # Encrypted 6-digit PIN codes
│   │   └── RolePermission.js    # Page/action permissions
│   ├── routes/
│   │   ├── access.js            # Access code login, code/permission management
│   │   ├── auth.js              # Username/password auth
│   │   ├── auth_routes.js       # Legacy duplicate
│   │   ├── roles.js             # Admin: list/update user roles
│   │   └── userLookup.js        # Retired
│   └── scripts/
│       ├── seedAdmin.js         # Creates default admin user
│       ├── seedAccessCodes.js   # Generates initial PIN codes
│       ├── testAuth.js          # Auth smoke test
│       ├── generateReport.js    # MD to PDF via Puppeteer
│       ├── checkUser.js         # User record diagnostic
│       ├── loginAs.js           # Quick login helper
│       └── rotateAdminPass.js   # Admin password rotation
├── frontend/
│   └── src/
│       ├── App.tsx              # Root component, login screen
│       ├── main.tsx             # Entry point
│       ├── index.css            # Tailwind CSS entry
│       ├── types.ts             # Shared TypeScript types
│       ├── authConfig.ts        # MSAL config (optional)
│       ├── auth/
│       │   ├── AuthContext.tsx   # Legacy auth context
│       │   └── RoleContext.tsx   # Role/permission context
│       ├── components/
│       │   ├── Navbar.tsx       # Navigation with role-aware links
│       │   └── ConfirmModal.tsx # Confirmation dialog
│       ├── data/
│       │   └── mockData.ts      # Sample dev data
│       ├── pages/
│       │   ├── RosterPage.tsx   # Roster/schedule view
│       │   ├── TrackerPage.tsx  # Daily productivity tracker
│       │   ├── SettingsPage.tsx # Settings & code management
│       │   ├── LogMonitorPage.tsx # Audit log viewer & health
│       │   ├── AdminPage.tsx    # User role management
│       │   └── Auth/
│       │       ├── LoginPanel.tsx   # Username/password login
│       │       └── RegisterPanel.tsx # Registration
│       └── utils/
│           ├── socket.ts        # Socket.IO client
│           ├── authToken.ts     # Bearer token storage
│           └── logger.ts        # Log management
├── package.json                 # Root scripts
├── DEPLOYMENT.md                # Deployment guide
└── SECURITY.md                  # Security measures
```

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local instance or MongoDB Atlas)

### 1. Clone & Install

```bash
git clone <repo-url>
cd queue-tracker
npm run install-all
```

### 2. Configure Environment

**Backend** (`backend/.env`):

```env
MONGODB_URI=mongodb://localhost:27017/queue_tracker
JWT_SECRET=your_strong_secret_at_least_32_chars
ACCESS_CODE_ENCRYPTION_KEY=another_strong_secret_at_least_32_chars
REGISTRATION_SECRET=your_registration_secret
FRONTEND_URL=http://localhost:5173
PORT=3001
NODE_ENV=development
```

**Frontend** (`frontend/.env`):

```env
VITE_BACKEND_URL=http://localhost:3001
```

### 3. Seed Initial Data

The server auto-seeds on first boot:
- **Default admin user:** `shubham.kumar` / `QHAdmin`
- **Access codes:** One 6-digit PIN per role (printed to console on first run only)

You can also run seeding manually:

```bash
cd backend
node scripts/seedAdmin.js
node scripts/seedAccessCodes.js
```

### 4. Run Development

```bash
# Terminal 1 — Backend
npm run dev-backend

# Terminal 2 — Frontend
npm run dev-frontend
```

Open **http://localhost:5173** in your browser.

## Authentication

### Access Code Login (Primary)

1. An admin provides you with a 6-digit access code for your role.
2. Enter your **Full Name** and the **6-digit PIN** on the login screen.
3. The server validates the code, determines your role, and issues a JWT.
4. The JWT is stored as an httpOnly cookie (for same-origin) and simultaneously returned in the response body as a Bearer token stored in sessionStorage (for cross-origin deployments like Netlify to Render).

### Username/Password Login (Alternative)

For registered account holders, enter your **username** and **password**. On success, a JWT is set as an httpOnly cookie.

### Registration

New accounts can be created via `POST /api/register` using a `REGISTRATION_SECRET` code.

## API Endpoints

### Authentication (`/api/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/access/login` | Login with full name + 6-digit access code |
| POST | `/api/register` | Register with username, password, registration secret |
| POST | `/api/login` | Login with username + password |
| POST | `/api/logout` | Clear auth cookie |
| GET | `/api/me` | Get current authenticated user |
| GET | `/api/csrf-token` | Fetch CSRF token for state-changing requests |
| GET | `/api/access/permissions` | Get current user's permissions (role, pages, actions) |

### Admin (`/api/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/roles` | List all users and their roles (admin only) |
| PUT | `/api/roles` | Update a user's role (admin only) |
| GET | `/api/access/codes` | View decrypted access codes (admin only) |
| POST | `/api/access/codes/:role/regenerate` | Regenerate a role's access code (admin only) |
| GET | `/api/access/permissions/:role` | View a role's permission matrix (admin only) |
| PUT | `/api/access/permissions/:role` | Update a role's permissions (admin only) |

### Log Download

| Method | Path | Description |
|--------|------|-------------|
| GET | `/download-logs/:date` | Download logs for a specific date |
| GET | `/download-all-logs` | Download all logs |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API status check |
| GET | `/health` | Health check endpoint |

## Environment Variables

### Backend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | Yes | `mongodb://localhost:27017/queue_tracker` | MongoDB connection string |
| `JWT_SECRET` | Yes (prod) | `dev_jwt_secret` | Secret for signing JWTs (>= 32 chars in production) |
| `ACCESS_CODE_ENCRYPTION_KEY` | Yes | — | Secret for encrypting/decrypting access codes (>= 32 chars) |
| `FRONTEND_URL` | Yes | `http://localhost:5173` | Frontend origin for CORS |
| `ALLOWED_ORIGINS` | No | — | Comma-separated extra CORS origins |
| `REGISTRATION_SECRET` | No | — | Secret code required for user registration |
| `BCRYPT_ROUNDS` | No | `12` | Bcrypt hash rounds |
| `PORT` | No | `3001` | Server port |
| `NODE_ENV` | No | — | Set to `production` for secure cookie settings |
| `ENFORCE_LOG_DOWNLOAD_AUTH` | No | `false` | Require admin auth for log downloads |
| `AUTH_LOGIN_WINDOW_MS` | No | `300000` | Rate limit window for logins (ms) |
| `AUTH_LOGIN_MAX` | No | `3` | Max login attempts per window |
| `AUTH_REGISTER_WINDOW_MS` | No | `3600000` | Rate limit window for registrations (ms) |
| `AUTH_REGISTER_MAX` | No | `3` | Max registrations per window |

### Frontend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_BACKEND_URL` | Yes | `http://localhost:3001` | Backend server URL |
| `VITE_MS_CLIENT_ID` | No | — | Azure AD / MSAL client ID (optional) |
| `VITE_MS_TENANT_ID` | No | — | Azure AD tenant ID (optional) |

## Roles & Permissions

Three roles are built in:

| Role | Description |
|------|-------------|
| **admin** | Full access to everything — pages, actions, user management, code regeneration |
| **queue_handler** | Can manage rosters, handlers, and view logs. Configurable by admin. |
| **associate** | Read-only view of roster and stats. Configurable by admin. |

### Permission Keys

**Pages:**
- `roster` — Roster/schedule page
- `stats` — Tracker/stats page
- `logMonitor` — Log monitor page
- `settings` — Settings page
- `admin` — Admin panel (never grantable — admin-only)

**Actions:**
- `editRoster` — Edit roster entries
- `editHandlers` — Add/edit/remove handlers
- `deleteLog` — Delete log entries
- `exportData` — Export spreadsheet data
- `manageUsers` — Manage user accounts
- `downloadLogs` — Download audit log files

## Security

See **[SECURITY.md](./SECURITY.md)** for a detailed overview of security controls including:

- CORS with origin whitelisting
- HTTP + Socket rate limiting
- Input sanitization (XSS prevention)
- JWT authentication with httpOnly cookies + Bearer tokens
- CSRF protection via double-submit cookie pattern
- AES-256-GCM encrypted access codes
- Rate-limited login endpoints
- Audit logging for all actions

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for instructions on deploying to Render (backend) and Netlify (frontend), including MongoDB Atlas setup.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run install-all` | Install dependencies for both frontend and backend |
| `npm run dev-frontend` | Start Vite dev server (frontend) |
| `npm run dev-backend` | Start backend with --watch file watcher |
| `npm run build` | Build frontend for production |
| `npm run start` | Start production backend |
| `npm run seed-admin` | Seed/re-seed the default admin user |

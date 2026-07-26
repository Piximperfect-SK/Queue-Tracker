<div align="center">

# 🎯 Queue Tracker

### Real-Time Productivity & Queue Management System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0+-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8.3-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-5.2.1-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Vite](https://img.shields.io/badge/Vite-7.3.1-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Deployed on Render](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render&logoColor=white)](https://render.com/)
[![Deployed on Netlify](https://img.shields.io/badge/Deployed-Netlify-00C7B7?logo=netlify&logoColor=white)](https://www.netlify.com/)

**A modern, enterprise-grade queue management platform with 2FA authentication, real-time collaboration, role-based access control, and comprehensive audit logging.**

**Developed by [Shubham Kumar](https://github.com/Piximperfect-SK)**

[Features](#-features) • [Tech Stack](#-tech-stack) • [Architecture](#-architecture) • [Security](#-security)

</div>

---

## 📋 About

Queue Tracker is a production-ready web application designed for teams managing customer queues, tracking daily productivity, and monitoring operations in real-time. Built with enterprise-grade security and modern web technologies, it provides seamless collaboration with instant updates across all connected users.

**Perfect for:** Call centers, support teams, service desks, or any organization needing structured queue management with accountability and real-time visibility.

### Why Queue Tracker?

- 🔐 **Bank-Grade Security** - 2FA authentication with encrypted storage and JWT sessions
- ⚡ **Real-Time Everything** - WebSocket-powered live updates, no page refresh needed
- 👥 **Smart User Management** - Admin approval workflow with role-based permissions
- 📊 **Productivity Insights** - Track daily performance with historical data
- 🔍 **Complete Transparency** - Audit every action with detailed logs
- 🎨 **Beautiful UX** - Modern, responsive design with intuitive workflows
- 🚀 **Production Ready** - Deployed on Render (backend) & Netlify (frontend) with MongoDB Atlas

---

## ✨ Features

### 🔐 **Authentication & Security**

**Two-Factor Authentication (2FA)**
- QR code-based TOTP setup compatible with Google Authenticator, Authy, and any TOTP app
- New users scan QR code on first login → instant 2FA enrollment
- 8 single-use backup codes generated per user for emergency access
- Codes are bcrypt hashed and stored securely

**Admin Approval Workflow**
- New registrations require admin approval before access is granted
- Admin reviews user requests and assigns appropriate roles
- Prevents unauthorized access while allowing self-service onboarding

**Session Management**
- JWT-based authentication with 8-hour session expiry
- Server-side session tracking with revocation capability
- Admins can force logout any user from the admin panel
- Sessions stored in MongoDB with TTL indexes for auto-cleanup

**Data Encryption**
- All 2FA secrets encrypted using AES-256-GCM before storage
- Access codes and sensitive data protected with industry-standard encryption
- Environment-based encryption keys for different deployment stages

**Additional Security Layers**
- CSRF protection on all state-changing operations
- Rate limiting on authentication endpoints (prevents brute-force attacks)
- Secure HTTP-only cookies for token storage
- Input sanitization to prevent XSS and injection attacks

---

### 👥 **Role-Based Access Control (RBAC)**

**Three User Roles**
- **Admin** - Full system access, user management, permission configuration
- **Queue Handler** - Manage queues, update rosters, view logs
- **Associate** - View-only access, limited interaction

**Granular Permissions**
- Page-level access control (who can see which pages)
- Action-level permissions (who can edit, delete, export)
- Dynamic permission updates without code changes
- Admin configures permissions through the web interface

**Smart Role Assignment**
- Hardcoded admin: "Shubham Kumar" always has admin privileges
- New users assigned roles during approval process
- Role changes take effect immediately across all sessions

---

### 📊 **Queue & Productivity Management**

**Daily Tracker**
- Log incidents, tasks, calls per team member
- Real-time counter updates as work is logged
- Date-based filtering to view historical data
- Color-coded status indicators for quick insights

**Roster Management**
- Create and manage team schedules with visual drag-and-drop interface
- **Flexible Excel Import** - Auto-detects wide format (dates as columns) and long format (one row per date)
- Support for multiple date formats in Excel (ISO dates, written format like "25th July 2026")
- **Queue Handler (QH) Assignment** - Designate team members as Queue Handlers per shift/day
- Auto-assign QH for specific shifts:
  - **Morning (6AM-3PM)**: All assigned handlers become QH
  - **Night (10PM-7AM)**: All assigned handlers become QH
  - **Weekend shifts**: All working handlers become QH
  - **Weekday normal shifts**: Default QH (configurable team members) + manual override
- Manual QH override with star icon - click to toggle QH status per handler/shift
- **Custom Shift Creation** - Admins can add new shifts beyond defaults (e.g., "3PM-12AM", "4AM-1PM")
- Custom shifts persist in localStorage and appear in all roster views
- Visual calendar view of who's working when
- QH display in topbar: "Shift QH: Kanchan & Akanksha & Jyoti"
- Gold highlight for QH handlers in shift columns
- Export roster data for reporting

**Live Statistics**
- Real-time productivity metrics dashboard
- Per-user performance tracking
- Cumulative team statistics
- Trend analysis over custom date ranges

**Queue Status Dashboard**
- Current queue size and wait times
- Active handlers and their status
- Priority queue management
- Historical queue performance data

---

### 🔴 **Real-Time Collaboration**

**WebSocket-Powered Live Updates**
- Changes made by one user instantly appear for all connected users
- No manual refresh needed - see updates as they happen
- Works across multiple browser tabs and devices

**Online Presence Tracking**
- See who's currently active in the system
- Real-time online/offline status indicators
- User connection/disconnection notifications

**Live Notifications**
- Instant alerts for important events
- User approval notifications for admins
- Session revocation alerts
- System status updates

**Connection Resilience**
- Automatic reconnection on network interruption
- Exponential backoff retry strategy
- Visual connection status indicator
- Graceful degradation if WebSocket unavailable

---

### 📝 **Audit Logging & Monitoring**

**Complete Audit Trail**
- Every action logged with timestamp, user, and details
- Immutable log entries for compliance and security
- Searchable and filterable log viewer
- Date-range queries for historical analysis

**Log Categories**
- Authentication events (login, logout, failed attempts)
- Data modifications (roster changes, tracker updates)
- Administrative actions (user approval, role changes)
- System events (errors, warnings, performance metrics)

**Export & Reporting**
- Download logs as formatted text files
- CSV export for external analysis
- Generate PDF reports (via Puppeteer)
- Scheduled log archival

**System Health Dashboard**
- Backend API status monitoring
- Database connectivity checks
- Real-time uptime tracking
- Performance metrics visualization

---

### ⚙️ **Admin Control Panel**

**User Management**
- **Approvals Tab** - Review and approve/reject new registrations
- **Manage Users Tab** - View all registered users with their roles
  - Change user roles post-approval (roles take effect on next page load)
  - Delete users from database with confirmation dialog
  - Safety checks: Prevent deleting self, prevent deleting last admin
- **Session Monitoring** - View active sessions, force logout users

**Permission Matrix**
- Configure page-level permissions for each role
- Set action-level permissions (view, edit, delete, export)
- Changes apply instantly without redeployment
- Lock icon with hover tooltip shows access restrictions (no modal)

**Access Code System** (Legacy PIN-based auth)
- Generate 6-digit PIN codes for device/kiosk access
- Encrypt codes before storage
- Assign codes to specific users or roles
- Revoke compromised codes instantly

**Two-Factor Administration**
- View all users with 2FA enabled
- Reset 2FA for locked-out users
- Display backend error details during 2FA approval for debugging
- Monitor backup code usage
- Enforce 2FA policy across organization

**Shift Management** (Settings page)
- Admins can create custom shifts beyond default roster shifts
- Input field with validation for new shift times (e.g., "3PM-12AM")
- Delete custom shifts with confirmation
- Custom shifts persist across sessions and appear in all roster views

---

### 🎯 **Recent Improvements (v4.0.0)**

**Enhanced Roster Intelligence**
- ✅ Show all handler names without truncation - improved visibility
- ✅ Shift-specific Queue Handler assignment with auto-detection
- ✅ Custom shift management for flexibility
- ✅ Queue Handler status display in topbar

**Admin Panel Refinements**
- ✅ Compact, natural UI - reduced padding and spacing
- ✅ Post-approval user role management
- ✅ User deletion with safety checks
- ✅ Error details display for debugging (2FA approval, etc.)

**User Experience**
- ✅ Lock icon with hover tooltips for access restrictions (no disruptive modals)
- ✅ Improved Excel import with dual-format auto-detection
- ✅ Support for flexible date formats in roster imports
- ✅ Grid-based layout for users and data (more compact)

---

## 🛠 Tech Stack

### **Frontend**

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.x | Modern UI library with hooks and concurrent features |
| **TypeScript** | 5.x | Type-safe development with enhanced IDE support |
| **Vite** | 7.3.1 | Lightning-fast dev server and optimized production builds |
| **Tailwind CSS** | 4.0 | Utility-first CSS framework for rapid UI development |
| **React Router** | 7.x | Client-side routing with code splitting |
| **Socket.IO Client** | 4.8.3 | Real-time bidirectional communication |
| **Lucide React** | Latest | Beautiful, consistent icon library |
| **Recharts** | Latest | Responsive charts for data visualization |
| **@dnd-kit** | Latest | Smooth drag-and-drop interactions |

---

### **Backend**

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 24.15.0 | JavaScript runtime with modern ES modules |
| **Express** | 5.2.1 | Minimalist web framework for APIs |
| **MongoDB** | 6.0+ | NoSQL database for flexible data storage |
| **Mongoose** | 9.1.2 | Elegant MongoDB object modeling |
| **Socket.IO** | 4.8.3 | WebSocket server with polling fallback |
| **JWT** | 9.0.0 | Stateless authentication tokens |
| **bcrypt** | 6.0.0 | Secure password and backup code hashing |
| **otplib** | 12.0.1 | TOTP generation and verification |
| **qrcode** | Latest | QR code generation for 2FA setup |
| **express-rate-limit** | 8.2.1 | DDoS and brute-force protection |
| **csurf** | 1.11.0 | CSRF token validation |
| **dotenv** | 17.2.3 | Environment variable management |
| **cookie-parser** | 1.4.6 | Parse and set HTTP cookies |
| **cors** | 2.8.5 | Cross-Origin Resource Sharing configuration |

---

### **Security & Encryption**

| Technology | Purpose |
|------------|---------|
| **AES-256-GCM** | Encrypt 2FA secrets before database storage |
| **AES-256-CBC** | Encrypt pending user data during approval process |
| **bcrypt** | Hash passwords and backup codes (cost factor 10) |
| **JWT with jti** | Revocable session tokens with unique identifiers |
| **CSRF Tokens** | Prevent cross-site request forgery attacks |
| **Rate Limiting** | Protect authentication endpoints from abuse |
| **Input Sanitization** | Strip HTML/script tags from user input |
| **Secure Cookies** | HTTP-only, SameSite cookies for token storage |

---

### **DevOps & Infrastructure**

| Service | Purpose |
|---------|---------|
| **Render** | Backend hosting with auto-deploy from GitHub |
| **Netlify** | Frontend hosting with CDN and instant deploys |
| **MongoDB Atlas** | Managed cloud database with automated backups |
| **GitHub** | Version control and CI/CD trigger |
| **Git** | Source code management |

---

## 🏗 Architecture

### **System Design**

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Browser   │  │   Browser   │  │   Browser   │         │
│  │   (User 1)  │  │   (User 2)  │  │   (User 3)  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                 │                 │                 │
│         └─────────────────┴─────────────────┘                │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │   Netlify CDN   │
                   │   (Frontend)    │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │  React SPA      │
                   │  TypeScript     │
                   │  Tailwind CSS   │
                   └────────┬────────┘
                            │
                   HTTP/WebSocket
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                   ┌───────▼──────┐                            │
│                   │  Render.com  │                            │
│                   │   (Backend)  │                            │
│                   └───────┬──────┘                            │
│                           │                                   │
│         ┌─────────────────┴─────────────────┐                │
│         │                                     │                │
│  ┌──────▼───────┐                   ┌────────▼────────┐      │
│  │ Express API  │◄──────────────────┤ Socket.IO Server│      │
│  │   (REST)     │                   │   (WebSocket)   │      │
│  └──────┬───────┘                   └────────┬────────┘      │
│         │                                     │                │
│    ┌────┴────┐                          ┌────┴────┐          │
│    │  Auth   │                          │ Real-   │          │
│    │ Routes  │                          │  Time   │          │
│    └────┬────┘                          │ Events  │          │
│         │                               └────┬────┘          │
│         └────────────┬─────────────────┬────┘               │
│                      │                  │                     │
└──────────────────────┼──────────────────┼────────────────────┘
                       │                  │
                ┌──────▼──────┐    ┌─────▼──────┐
                │  MongoDB    │    │  MongoDB   │
                │  (Sessions) │    │  (State)   │
                └─────────────┘    └────────────┘
                       │                  │
                       └────────┬─────────┘
                                │
                      ┌─────────▼──────────┐
                      │  MongoDB Atlas     │
                      │  (Cloud Database)  │
                      └────────────────────┘
```

### **Data Flow**

1. **User Login** → Frontend → Backend `/api/access/lookup`
2. **2FA Verification** → Backend verifies TOTP → Creates JWT session
3. **WebSocket Connection** → Client connects with JWT token
4. **Real-Time Updates** → User action → MongoDB → Socket.IO broadcast → All clients
5. **Session Management** → JWT validated on each request → MongoDB session check

### **Database Collections**

| Collection | Purpose |
|------------|---------|
| **users** | User accounts with roles and credentials |
| **twofactorauths** | Encrypted 2FA secrets and backup codes |
| **pendingusers** | New registrations awaiting admin approval |
| **sessions** | Active JWT sessions with revocation support |
| **accesscodes** | Legacy PIN codes for device authentication |
| **rolepermissions** | Page and action permissions per role |
| **logs** | Audit trail of all system activities |
| **states** | Application state (roster, tracker, stats) |

---

## 🔒 Security Features

### **Multi-Layer Security**

**Authentication**
- Time-based One-Time Passwords (TOTP) with 30-second validity window
- QR code enrollment compatible with all standard authenticator apps
- 8 bcrypt-hashed backup codes per user (single-use, cost factor 10)
- JWT tokens with 8-hour expiry and server-side revocation
- Rate-limited authentication endpoints (max 5 attempts per minute)

**Data Protection**
- AES-256-GCM encryption for all 2FA secrets at rest
- AES-256-CBC encryption for pending approval data
- Environment-based encryption keys (never committed to repository)
- Secure HTTP-only cookies with SameSite protection
- All sensitive data encrypted before MongoDB storage

**Request Security**
- CSRF token validation on all state-changing operations
- Input sanitization to prevent XSS and SQL injection
- CORS configured for trusted frontend origins only
- Express trust proxy for accurate IP detection behind CDN
- Connection rate limiting to prevent DDoS attacks

**Session Management**
- Unique JWT ID (jti) for each session enables instant revocation
- Sessions stored in MongoDB with TTL indexes for auto-expiry
- Admins can force-logout any user from the admin panel
- Automatic cleanup of expired sessions

**Audit & Compliance**
- Every action logged with timestamp, user, and IP address
- Immutable log entries for forensic analysis
- Failed login attempts tracked and logged
- Admin actions audited separately for accountability

---

## 🌐 Deployment & Production

**Current Deployment:**
- **Frontend:** Netlify with CDN and automatic SSL
- **Backend:** Render with auto-scaling and health checks
- **Database:** MongoDB Atlas with automated daily backups
- **CI/CD:** Auto-deploy on push to `main` branch via GitHub

**Environment Configuration:**
- Production uses strong encryption keys stored in environment variables
- CORS configured for production frontend URL
- Rate limits optimized for production traffic
- Database connection pooling for high concurrency

**Monitoring:**
- Backend health check endpoint at `/health`
- Real-time connection status indicators in UI
- Automatic reconnection on network interruption
- Error logging and performance metrics

---

## 👨‍💻 Developer

**Developed by:** [Shubham Kumar](https://github.com/Piximperfect-SK)

**Project Repository:** [github.com/Piximperfect-SK/Queue-Tracker](https://github.com/Piximperfect-SK/Queue-Tracker)

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2026 Shubham Kumar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- **React Team** - For the amazing UI library
- **MongoDB** - For flexible NoSQL data storage
- **Socket.IO** - For real-time bidirectional communication
- **Tailwind Labs** - For the beautiful utility-first CSS framework
- **Vite Team** - For the blazing fast build tool
- **Open Source Community** - For countless libraries that made this possible

---

<div align="center">

**⭐ Star this repository if you find it helpful!**

Made with ❤️ by [Shubham Kumar](https://github.com/Piximperfect-SK)

</div>

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security: Rate limiting for HTTP requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Root route for verification
app.get('/', (req, res) => res.status(200).send('Queue Tracker API is Live!'));
// Add health check endpoint
app.get('/health', (req, res) => res.status(200).send('Backend is running'));

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// STRICT CORS: Only allow the authorized frontend and localhost for development
const corsOptions = {
  origin: (origin, callback) => {
    const isLocalhost = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
    
    if (!origin || isLocalhost || origin === FRONTEND_URL) {
      callback(null, true);
    } else {
      console.warn(`BLOCKED CORS connection from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions
});

// Security: Simple sanitizer to prevent HTML/Script injection
const sanitize = (text) => {
  if (typeof text !== 'string') return text;
  return text.replace(/<[^>]*>/g, '').trim();
};

const TEAM_ACCESS_KEY = process.env.TEAM_ACCESS_KEY || ""; // If empty, no key required

// Socket Throttling Helper
const eventCounts = new Map();
const socketRateLimit = (socket, next) => {
  const socketId = socket.id;
  const now = Date.now();
  
  if (!eventCounts.has(socketId)) {
    eventCounts.set(socketId, { count: 0, lastReset: now });
  }
  
  const stats = eventCounts.get(socketId);
  if (now - stats.lastReset > 1000) { // Reset every second
    stats.count = 0;
    stats.lastReset = now;
  }
  
  stats.count++;
  if (stats.count > 20) { // Max 20 events per second per socket
    console.warn(`Socket ${socketId} exceeded rate limit`);
    return false; // Stop processing
  }
  return true;
};

const DATA_FILE = path.join(__dirname, 'data.json');

// Load initial data
let db = {
  agents: [],
  roster: [],
  stats: [],
  logs: {}
};

let onlineUsers = new Map(); // socket.id -> username

if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading data file', e);
  }
}

const saveData = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
};

app.get('/download-logs/:date', (req, res) => {
  const { date } = req.params;
  const logs = db.logs[date] || [];
  
  if (logs.length === 0) {
    return res.status(404).send('No logs found for this date');
  }

  const content = logs.map(l => `[${l.timestamp}] ${l.user.toUpperCase()} - ${l.action.toUpperCase()}: ${l.details}`).join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename=QueueTracker_Logs_${date}.txt`);
  res.send(content);
});

app.get('/download-all-logs', (req, res) => {
  let content = '=== QUEUE TRACKER FULL AUDIT LOG ===\n';
  content += `Export Date: ${new Date().toLocaleString()}\n\n`;
  
  Object.entries(db.logs)
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .forEach(([date, logs]) => {
      content += `DATE: ${date}\n`;
      content += logs.map(l => `  [${l.timestamp}] ${l.user.toUpperCase()} - ${l.action.toUpperCase()}: ${l.details}`).join('\n');
      content += '\n\n';
    });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=QueueTracker_FullHistory.txt');
  res.send(content);
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Apply rate limiting to all incoming socket events
  socket.use(([event, ...args], next) => {
    if (socketRateLimit(socket)) {
      next();
    } else {
      socket.emit('error_message', 'Slow down! Too many requests.');
    }
  });

  // Send initial data
  socket.emit('init', db);
  
  // IMMEDIATELY broadcast current online users to EVERYONE
  // This ensures new tabs see everyone and everyone sees the new connection attempt
  const broadcastPresence = () => {
    io.emit('presence_updated', Array.from(onlineUsers.values()));
  };

  broadcastPresence();

  socket.on('get_presence', () => {
    socket.emit('presence_updated', Array.from(onlineUsers.values()));
  });

  socket.on('get_initial_data', () => {
    socket.emit('init', db);
  });

  socket.on('join', ({ username, accessKey }) => {
    const cleanName = sanitize(username);
    // Security check: If a key is required, validate it
    if (TEAM_ACCESS_KEY && accessKey !== TEAM_ACCESS_KEY) {
      console.warn(`Unauthorized join attempt from ${cleanName} with key: ${accessKey}`);
      return socket.emit('error_message', 'Invalid Team Access Key. Access Denied.');
    }

    onlineUsers.set(socket.id, cleanName);
    broadcastPresence();
    console.log(`${cleanName} joined. Online:`, Array.from(onlineUsers.values()));
  });

  socket.on('update_agents', (agents) => {
    // Sanitize agent names
    const cleanAgents = agents.map(a => ({ ...a, name: sanitize(a.name) }));
    db.agents = cleanAgents;
    saveData();
    socket.broadcast.emit('agents_updated', cleanAgents);
  });

  socket.on('update_roster', (roster) => {
    db.roster = roster;
    saveData();
    socket.broadcast.emit('roster_updated', roster);
  });

  socket.on('update_stats', (stats) => {
    db.stats = stats;
    saveData();
    socket.broadcast.emit('stats_updated', stats);
  });

  socket.on('add_log', (logEntry) => {
    const cleanEntry = {
      ...logEntry,
      user: sanitize(logEntry.user),
      details: sanitize(logEntry.details)
    };
    const dateStr = new Date().toISOString().split('T')[0];
    if (!db.logs[dateStr]) db.logs[dateStr] = [];
    db.logs[dateStr].push(cleanEntry);
    saveData();
    socket.broadcast.emit('log_added', { dateStr, logEntry: cleanEntry });
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    eventCounts.delete(socket.id); // Clean up rate limit tracking
    if (username) {
      onlineUsers.delete(socket.id);
      io.emit('presence_updated', Array.from(onlineUsers.values()));
      console.log(`User ${username} (${socket.id}) disconnected. Remaining:`, Array.from(onlineUsers.values()));
    } else {
      console.log(`Anonymous socket ${socket.id} disconnected.`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Real-time server running on port ${PORT}`);
});

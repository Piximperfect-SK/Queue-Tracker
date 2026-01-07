import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/queue_tracker";
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Schema
const stateSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  agents: { type: Array, default: [] },
  roster: { type: Array, default: [] },
  stats: { type: Array, default: [] }
});

const logSchema = new mongoose.Schema({
  dateStr: { type: String, index: true },
  timestamp: String,
  user: String,
  action: String,
  details: String
});

const State = mongoose.model('State', stateSchema);
const Log = mongoose.model('Log', logSchema);

// Migration logic: Only runs once to move data from data.json to MongoDB
const migrateData = async () => {
  try {
    const DATA_FILE = path.join(__dirname, 'data.json');
    const fs = await import('fs');
    if (fs.existsSync(DATA_FILE)) {
      console.log('--- MIGRATION DETECTED: data.json found ---');
      const dbFile = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      
      // Migrate State
      const existingState = await State.findOne({ key: 'global' });
      if (!existingState) {
        await State.create({
          key: 'global',
          agents: dbFile.agents || [],
          roster: dbFile.roster || [],
          stats: dbFile.stats || []
        });
        console.log('Global state migrated.');
      }

      // Migrate Logs
      const logCount = await Log.countDocuments();
      if (logCount === 0 && dbFile.logs) {
        const logsToInsert = [];
        Object.entries(dbFile.logs).forEach(([dateStr, logs]) => {
          logs.forEach(l => {
            logsToInsert.push({ ...l, dateStr });
          });
        });
        if (logsToInsert.length > 0) {
          await Log.insertMany(logsToInsert);
          console.log(`${logsToInsert.length} logs migrated.`);
        }
      }
      
      // Rename file once migrated to prevent re-migration
      fs.renameSync(DATA_FILE, DATA_FILE + '.migrated');
      console.log('Migration complete. data.json renamed to data.json.migrated');
    }
  } catch (err) {
    console.warn('Migration skipped or failed (likely no data.json or already migrated):', err.message);
  }
};

migrateData();

// Security: Rate limiting for HTTP requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/socket.io/'), // Don't rate limit socket handshake
});
app.use(limiter);

// Root route for verification
app.get('/', (req, res) => res.status(200).send('Queue Tracker API is Live!'));
// Add health check endpoint
app.get('/health', (req, res) => res.status(200).send('Backend is running'));

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

// STRICT CORS: Only allow the authorized frontend and localhost for development
const corsOptions = {
  origin: (origin, callback) => {
    // If no origin (like mobile apps or curl), or if it matches our allowed patterns
    const cleanOrigin = origin ? origin.replace(/\/$/, "") : null;
    const isLocalhost = cleanOrigin && (cleanOrigin.includes('localhost') || cleanOrigin.includes('127.0.0.1'));
    
    if (!origin || isLocalhost || cleanOrigin === FRONTEND_URL) {
      callback(null, true);
    } else {
      console.warn(`BLOCKED CORS connection from: ${origin}. Expected: ${FRONTEND_URL}`);
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

const TEAM_ACCESS_KEY = (process.env.TEAM_ACCESS_KEY || "").trim(); // Ensure no sneaky spaces
console.log('--- SECURITY CONFIG ---');
console.log('Team Access Key:', TEAM_ACCESS_KEY ? 'PROTECTED (Key set)' : 'UNPROTECTED (No key set)');
console.log('Frontend URL:', FRONTEND_URL);
console.log('-----------------------');

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

// Helper to get full state
const getFullState = async () => {
  let state = await State.findOne({ key: 'global' });
  if (!state) {
    state = await State.create({ key: 'global' });
  }
  return state;
};

app.get('/download-logs/:date', async (req, res) => {
  const { date } = req.params;
  const logs = await Log.find({ dateStr: date }).sort({ timestamp: 1 });
  
  if (logs.length === 0) {
    return res.status(404).send('No logs found for this date');
  }

  const content = logs.map(l => `[${l.timestamp}] ${l.user.toUpperCase()} - ${l.action.toUpperCase()}: ${l.details}`).join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename=QueueTracker_Logs_${date}.txt`);
  res.send(content);
});

app.get('/download-all-logs', async (req, res) => {
  let content = '=== QUEUE TRACKER FULL AUDIT LOG ===\n';
  content += `Export Date: ${new Date().toLocaleString()}\n\n`;
  
  const logs = await Log.find().sort({ dateStr: -1, timestamp: 1 });
  
  let currentDate = "";
  logs.forEach(l => {
    if (l.dateStr !== currentDate) {
      currentDate = l.dateStr;
      content += `\nDATE: ${currentDate}\n`;
    }
    content += `  [${l.timestamp}] ${l.user.toUpperCase()} - ${l.action.toUpperCase()}: ${l.details}\n`;
  });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=QueueTracker_FullHistory.txt');
  res.send(content);
});

io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);

  // Apply rate limiting to all incoming socket events
  socket.use(([event, ...args], next) => {
    if (socketRateLimit(socket)) {
      next();
    } else {
      socket.emit('error_message', 'Slow down! Too many requests.');
    }
  });

  // IMMEDIATELY broadcast current online users to EVERYONE
  // This ensures new tabs see everyone and everyone sees the new connection attempt
  const broadcastPresence = () => {
    io.emit('presence_updated', Array.from(onlineUsers.values()));
  };

  const sendSyncData = async () => {
    const state = await getFullState();
    socket.emit('init', state);
  };

  broadcastPresence();

  socket.on('get_presence', () => {
    socket.emit('presence_updated', Array.from(onlineUsers.values()));
  });

  socket.on('get_initial_data', async () => {
    await sendSyncData();
  });

  socket.on('join', async ({ username, accessKey }) => {
    const cleanName = sanitize(username);
    const cleanKey = (accessKey || "").trim();

    // Security check: If a key is required, validate it
    if (TEAM_ACCESS_KEY && cleanKey !== TEAM_ACCESS_KEY) {
      console.warn(`Unauthorized join attempt from ${cleanName} with key: ${cleanKey}`);
      return socket.emit('error_message', 'Invalid Team Access Key. Access Denied.');
    }

    onlineUsers.set(socket.id, cleanName);
    broadcastPresence();
    
    // Send full data again upon successful join to ensure sync
    await sendSyncData();
    
    console.log(`${cleanName} joined. Online:`, Array.from(onlineUsers.values()));
  });

  socket.on('update_agents', async (agents) => {
    // Sanitize agent names
    const cleanAgents = agents.map(a => ({ ...a, name: sanitize(a.name) }));
    await State.updateOne({ key: 'global' }, { $set: { agents: cleanAgents } });
    socket.broadcast.emit('agents_updated', cleanAgents);
  });

  socket.on('update_roster', async (roster) => {
    await State.updateOne({ key: 'global' }, { $set: { roster: roster } });
    socket.broadcast.emit('roster_updated', roster);
  });

  socket.on('update_stats', async (stats) => {
    await State.updateOne({ key: 'global' }, { $set: { stats: stats } });
    socket.broadcast.emit('stats_updated', stats);
  });

  socket.on('add_log', async (logEntry) => {
    const cleanEntry = {
      ...logEntry,
      user: sanitize(logEntry.user),
      details: sanitize(logEntry.details),
      dateStr: new Date().toISOString().split('T')[0]
    };
    await Log.create(cleanEntry);
    socket.broadcast.emit('log_added', { dateStr: cleanEntry.dateStr, logEntry: cleanEntry });
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    eventCounts.delete(socket.id); // Clean up rate limit tracking
    if (username) {
      onlineUsers.delete(socket.id);
      io.emit('presence_updated', Array.from(onlineUsers.values()));
      console.log(`User ${username} (${socket.id}) disconnected.`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Real-time server running on port ${PORT}`);
});

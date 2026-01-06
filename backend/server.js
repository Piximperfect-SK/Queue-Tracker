import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Expand CORS to allow common dev ports just in case
const allowedOrigins = [FRONTEND_URL, "http://localhost:5173", "http://localhost:5174", "http://localhost:3000"];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"]
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

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

  socket.on('join', (username) => {
    onlineUsers.set(socket.id, username);
    broadcastPresence();
    console.log(`${username} joined. Online:`, Array.from(onlineUsers.values()));
  });

  socket.on('update_agents', (agents) => {
    db.agents = agents;
    saveData();
    socket.broadcast.emit('agents_updated', agents);
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
    const dateStr = new Date().toISOString().split('T')[0];
    if (!db.logs[dateStr]) db.logs[dateStr] = [];
    db.logs[dateStr].push(logEntry);
    saveData();
    socket.broadcast.emit('log_added', { dateStr, logEntry });
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
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

// server.js — WorkTrust Main Server
require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const http      = require('http');
const { Server } = require('socket.io');
const routes    = require('./routes');
const fs        = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

global.io = io;

// ── Middleware ──
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static files ──
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Serve frontend from this project folder.
app.use(express.static(__dirname));

// ── API Routes ──
app.use('/api', routes);

// ── Health check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Serve frontend pages ──
app.get('/review.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'review.html'))
);
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

// ════════════════════════════════════════
//  SOCKET.IO — Live Location Tracking
// ════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Worker joins their room to receive booking notifications
  socket.on('join_worker', (workerId) => {
    socket.join(`worker_${workerId}`);
    console.log(`Worker ${workerId} joined room`);
  });

  // Client joins booking room to receive accept/reject
  socket.on('join_booking', (bookingId) => {
    socket.join(`booking_${bookingId}`);
  });

  // Worker broadcasts live location
  socket.on('worker_location', async ({ workerId, lat, lng }) => {
    try {
      const { User } = require('./models');
      await User.findByIdAndUpdate(workerId, {
        liveLocation: { lat, lng, updatedAt: new Date() }
      });
      // Broadcast to all clients watching this worker
      socket.broadcast.to(`watch_${workerId}`).emit('worker_location_update', { lat, lng, workerId });
    } catch(e) { console.error(e); }
  });

  // Client watches worker location
  socket.on('watch_worker', (workerId) => {
    socket.join(`watch_${workerId}`);
  });

  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// ── MongoDB + Start ──
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/worktrust';
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected:', MONGO_URI);
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0', () => {
      const LOCAL_IP = process.env.LOCAL_IP || 'localhost';
      console.log(`\n🚀 WorkTrust Server running!`);
      console.log(`   Local:   http://localhost:${PORT}`);
      console.log(`   Network: http://${LOCAL_IP}:${PORT}  ← Use this for QR on phone`);
      console.log(`\n📱 QR Review URL format:`);
      console.log(`   http://${LOCAL_IP}:${PORT}/review.html?token=<qrToken>&wid=<workerId>\n`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('\n💡 Make sure MongoDB is running:  brew services start mongodb-community');
    process.exit(1);
  });

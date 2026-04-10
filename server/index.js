require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const setupSocket = require('./socket/handler');

const app = express();
const server = http.createServer(app);

// Simple request logger for debugging Render
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:3000',
  'https://real-time-chat-application-interface.onrender.com'
];

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,   // Disabled to allow inline Angular styles
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve Angular frontend (production build)
// Prioritize local 'public' folder (good for containerized deploys)
let clientBuildPath = path.join(__dirname, 'public');
if (!fs.existsSync(clientBuildPath)) {
  // Fallback to sibling client folder (local development)
  clientBuildPath = path.join(__dirname, '..', 'client', 'dist', 'client', 'browser');
}

if (fs.existsSync(clientBuildPath)) {
  console.log(`📂 Serving static files from: ${clientBuildPath}`);
  app.use(express.static(clientBuildPath));

  // SPA catch-all: send index.html for any non-API route
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.warn('⚠️ Client build path not found. Static files will not be served.');
}

// Global error handling middleware
app.use((err, req, res, _next) => {
  // Handle multer file size / type errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File is too large. Maximum size is 15 MB.' });
  }
  if (err.message === 'File type not supported') {
    return res.status(415).json({ message: 'File type not supported.' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'Origin not allowed.' });
  }
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ message: 'Internal server error.' });
});

// Initialize socket handler
setupSocket(io);

// Connect to MongoDB and start server
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chitchat';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('📦 Connected to MongoDB');
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    });

    // Handle server listen errors (e.g., EADDRINUSE)
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Kill the other process or use a different port.`);
      } else {
        console.error('❌ Server error:', err.message);
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    if (err.message.includes('ETIMEOUT')) {
      console.error('TIP: This is likely a DNS issue or your IP is not whitelisted in MongoDB Atlas.');
    }
    process.exit(1);
  });

// MongoDB connection resilience
mongoose.connection.on('error', (err) => {
  console.error('📦 MongoDB connection error:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('📦 MongoDB disconnected. Mongoose will auto-reconnect.');
});

// Process-level safety nets
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = { app, server, io };

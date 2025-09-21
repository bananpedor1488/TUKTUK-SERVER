const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const csrf = require('csurf');
require('dotenv').config({ path: './config.env' });

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');
const aiRoutes = require('./routes/ai');
const { authenticateToken } = require('./middleware/auth');

// Import our professional services
const OnlineStatusManager = require('./services/OnlineStatusManager');
const SystemMonitor = require('./services/SystemMonitor');

const app = express();
const server = createServer(app);

// Initialize professional services
const onlineStatusManager = new OnlineStatusManager();
const systemMonitor = new SystemMonitor();

// Set up event listeners for OnlineStatusManager
onlineStatusManager.on('userOnline', (data) => {
  // Broadcast to all connected clients EXCEPT the user who just came online
  // This is handled by the socket.broadcast in the connection handler
  console.log(`📢 Broadcasting userOnline: ${data.userId} (${data.username})`);
});

onlineStatusManager.on('userOffline', (data) => {
  // Broadcast to all connected clients
  io.emit('userOffline', data);
  console.log(`📢 Broadcasting userOffline: ${data.userId} (${data.username})`);
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL,
      'https://tuktuk-five.vercel.app',
      'http://localhost:3000'
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
  skip: (req) => {
    // Skip rate limiting for health checks, AI endpoints and in development
    return req.path === '/api/health' || req.path.startsWith('/api/ai') || process.env.NODE_ENV === 'development';
  }
});

// AI-specific rate limiting (more lenient)
const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP for AI
  skip: (req) => {
    return process.env.NODE_ENV === 'development';
  }
});

// Online status rate limiting (strict)
const onlineStatusLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 5, // 5 requests per 10 seconds per IP
  message: {
    error: 'Too many online status requests',
    retryAfter: 10
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'development';
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));
app.use(limiter);
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    'https://tuktuk-five.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Cache-Control', 'Pragma'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 200 // Для поддержки старых браузеров
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Debug middleware for cookies
app.use((req, res, next) => {
  if (req.path.includes('/auth/') || req.path.includes('/user/')) {
    console.log('🍪 Cookies debug:', {
      path: req.path,
      method: req.method,
      cookies: Object.keys(req.cookies),
      hasRefreshToken: !!req.cookies.refreshToken
    });
  }
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', authenticateToken, chatRoutes);
app.use('/api/user', authenticateToken, userRoutes);
// AI роут с простой авторизацией (без проверки refresh token)
app.use('/api/ai', aiLimiter, aiRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Server time endpoint
app.get('/api/time', (req, res) => {
  res.json({ 
    serverTime: new Date().toISOString(),
    timestamp: Date.now()
  });
});

// Test endpoint to check user status
app.get('/api/test/user-status/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const User = require('./models/User');
    
    const user = await User.findById(userId, 'username isOnline lastSeen socketId');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      userId: user._id,
      username: user.username,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      socketId: user.socketId,
      lastSeenFormatted: user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'Never'
    });
  } catch (error) {
    console.error('Error fetching user status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Online users endpoint (Professional approach)
app.get('/api/users/online-status', onlineStatusLimiter, authenticateToken, async (req, res) => {
  try {
    const { userIds } = req.query;
    
    if (!userIds) {
      return res.status(400).json({ error: 'userIds parameter is required' });
    }
    
    const userIdArray = userIds.split(',');
    
    // Limit the number of users that can be requested at once
    if (userIdArray.length > 50) {
      return res.status(400).json({ error: 'Too many users requested. Maximum 50 users per request.' });
    }
    
    const statusMap = await onlineStatusManager.getUsersStatus(userIdArray);
    
    console.log('🔍 Online status API request:', {
      requestedUserIds: userIdArray.length,
      returnedStatuses: Object.keys(statusMap).length,
      ip: req.ip
    });
    
    res.json(statusMap);
  } catch (error) {
    console.error('Error fetching online status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// System monitoring endpoints
app.get('/api/system/health', authenticateToken, (req, res) => {
  try {
    const health = systemMonitor.getHealthStatus();
    res.json(health);
  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/system/stats', authenticateToken, (req, res) => {
  try {
    const stats = systemMonitor.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/system/dashboard', authenticateToken, (req, res) => {
  try {
    const dashboard = systemMonitor.getDashboardData();
    res.json(dashboard);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO connection handling
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    console.error('❌ Socket auth failed:', err.message);
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  console.log(`User ${socket.userId} connected`);
  
  // Record connection in system monitor
  systemMonitor.recordConnection(socket.userId, 'connect');
  
  try {
    // Use our professional OnlineStatusManager
    const result = await onlineStatusManager.userConnected(
      socket.userId, 
      socket.id, 
      socket.username || 'Unknown'
    );
    
    // Send current online users to the newly connected user
    const onlineUsers = onlineStatusManager.getAllOnlineUsers();
    socket.emit('onlineUsersSync', {
      users: onlineUsers.reduce((acc, user) => {
        acc[user.userId] = {
          username: user.username,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        };
        return acc;
      }, {})
    });
    
    // Notify ALL OTHER connected users about this user coming online
    // This ensures that existing users see the new user as online
    console.log(`📢 Broadcasting userOnline to all other users: ${socket.userId} (${socket.username || 'Unknown'})`);
    socket.broadcast.emit('userOnline', {
      userId: socket.userId,
      username: socket.username || 'Unknown',
      lastSeen: new Date(),
      socketId: socket.id
    });
    
    console.log(`✅ User ${socket.userId} is now online`);
  } catch (error) {
    console.error('Error handling user connection:', error);
    systemMonitor.recordError(error, { context: 'user_connection', userId: socket.userId });
  }
  
  // Join user to their personal room
  socket.join(`user_${socket.userId}`);
  
  // Handle joining chat rooms
  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`User ${socket.userId} joined chat ${chatId}`);
  });
  
  // Handle leaving chat rooms
  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
    console.log(`User ${socket.userId} left chat ${chatId}`);
  });
  
  // Handle new messages
  socket.on('send_message', async (data) => {
    try {
      const Message = require('./models/Message');
      const Chat = require('./models/Chat');
      
      const message = new Message({
        chat: data.chatId,
        sender: socket.userId,
        content: data.content,
        type: data.type || 'text'
      });
      
      await message.save();
      
      // Update chat's last message
      await Chat.findByIdAndUpdate(data.chatId, {
        lastMessage: message._id,
        updatedAt: new Date()
      });
      
      // Get full message with sender info
      const fullMessage = await Message.findById(message._id)
        .populate('sender', 'username displayName avatar');
      
      // Get chat participants for notifications
      const chat = await Chat.findById(data.chatId).populate('participants', '_id');
      
      // Broadcast message to chat room
      const messageData = {
        _id: fullMessage._id,
        chat: data.chatId,
        sender: {
          _id: fullMessage.sender._id,
          username: fullMessage.sender.username,
          displayName: fullMessage.sender.displayName,
          avatar: fullMessage.sender.avatar
        },
        content: data.content,
        type: data.type || 'text',
        createdAt: fullMessage.createdAt
      };
      
      io.to(`chat_${data.chatId}`).emit('new_message', messageData);
      
      // Record message in system monitor
      systemMonitor.recordMessage(data.chatId, socket.userId, data.type || 'text');
      
      // Notify all chat participants about chat update (for chat list)
      if (chat && chat.participants) {
        chat.participants.forEach(participant => {
          const participantId = participant._id.toString();
          
          // Send to personal room
          io.to(`user_${participantId}`).emit('chat_updated', {
            chatId: data.chatId,
            lastMessage: messageData,
            updatedAt: new Date()
          });
          
          // Also send to chat room (in case user is in chat)
          io.to(`chat_${data.chatId}`).emit('chat_updated', {
            chatId: data.chatId,
            lastMessage: messageData,
            updatedAt: new Date()
          });
        });
      }
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing_start', (data) => {
    socket.to(`chat_${data.chatId}`).emit('user_typing', {
      userId: socket.userId,
      chatId: data.chatId
    });
  });
  
  socket.on('typing_stop', (data) => {
    socket.to(`chat_${data.chatId}`).emit('user_stopped_typing', {
      userId: socket.userId,
      chatId: data.chatId
    });
  });
  
  // Handle status updates
  socket.on('update_status', (data) => {
    // This can be extended for custom status messages
    console.log(`User ${socket.userId} updated status: ${data.status}`);
  });
  
  // Handle heartbeat/ping to keep connection alive
  socket.on('user-activity', async () => {
    try {
      await onlineStatusManager.updateUserActivity(socket.userId);
    } catch (error) {
      console.error('Error updating user activity:', error);
    }
  });
  
  socket.on('ping', () => {
    socket.emit('pong');
  });
  
  socket.on('disconnect', async () => {
    console.log(`User ${socket.userId} disconnected`);
    
    // Record disconnection in system monitor
    systemMonitor.recordConnection(socket.userId, 'disconnect');
    
    try {
      await onlineStatusManager.userDisconnected(socket.userId);
    } catch (error) {
      console.error('Error handling user disconnection:', error);
      systemMonitor.recordError(error, { context: 'user_disconnection', userId: socket.userId });
    }
  });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


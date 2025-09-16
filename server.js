const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config({ path: './config.env' });

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');
const aiRoutes = require('./routes/ai');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const server = createServer(app);

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

// Middleware
app.use(helmet());
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

io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);
  
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
  
  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
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


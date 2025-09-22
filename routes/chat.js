const express = require('express');
const { body, validationResult } = require('express-validator');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');

const router = express.Router();

// Get all chats for current user
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;
    
    const chats = await Chat.find({
      participants: userId,
      isActive: true,
      archivedBy: { $ne: userId }
    })
    .populate('participants', 'username displayName avatar')
    .populate('lastMessage')
    .populate('createdBy', 'username displayName')
    .sort({ updatedAt: -1 });

    res.json({ chats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get archived chats for current user
router.get('/archived', async (req, res) => {
  try {
    const userId = req.userId;

    const chats = await Chat.find({
      participants: userId,
      isActive: true,
      archivedBy: userId
    })
      .populate('participants', 'username displayName avatar')
      .populate('lastMessage')
      .populate('createdBy', 'username displayName')
      .sort({ updatedAt: -1 });

    res.json({ chats });
  } catch (error) {
    console.error('Get archived chats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Archive/unarchive chat for current user
router.put('/:chatId/archive', [
  body('archived').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { chatId } = req.params;
    const { archived } = req.body;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const has = chat.archivedBy?.some(id => id.toString() === userId);
    if (archived && !has) {
      chat.archivedBy = [...(chat.archivedBy || []), userId];
    } else if (!archived && has) {
      chat.archivedBy = chat.archivedBy.filter(id => id.toString() !== userId);
    }
    await chat.save();
    res.json({ success: true, archived });
  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Mute/unmute chat for current user
router.put('/:chatId/mute', [
  body('muted').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { chatId } = req.params;
    const { muted } = req.body;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const has = chat.mutedBy?.some(id => id.toString() === userId);
    if (muted && !has) {
      chat.mutedBy = [...(chat.mutedBy || []), userId];
    } else if (!muted && has) {
      chat.mutedBy = chat.mutedBy.filter(id => id.toString() !== userId);
    }
    await chat.save();
    res.json({ success: true, muted });
  } catch (error) {
    console.error('Mute chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new chat
router.post('/', [
  body('participants').isArray({ min: 1 }),
  body('type').optional().isIn(['private', 'group']),
  body('name').optional().isLength({ max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { participants, type = 'private', name } = req.body;
    const userId = req.userId;

    // Add current user to participants
    const allParticipants = [...new Set([userId, ...participants])];

    // For private chats, check if chat already exists
    if (type === 'private' && allParticipants.length === 2) {
      const existingChat = await Chat.findOne({
        type: 'private',
        participants: { $all: allParticipants, $size: 2 },
        isActive: true
      }).populate('participants', 'username displayName avatar isOnline lastSeen');

      if (existingChat) {
        return res.json({ chat: existingChat });
      }
    }

    // Validate participants exist
    const participantUsers = await User.find({
      _id: { $in: allParticipants }
    });

    if (participantUsers.length !== allParticipants.length) {
      return res.status(400).json({ message: 'Some participants not found' });
    }

    // Create new chat
    const chat = new Chat({
      participants: allParticipants,
      type,
      name: type === 'group' ? name : undefined,
      createdBy: userId
    });

    await chat.save();

    // Populate and return
    await chat.populate('participants', 'username displayName avatar isOnline lastSeen');
    await chat.populate('createdBy', 'username displayName');

    res.status(201).json({ chat });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get chat by ID
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      isActive: true
    })
    .populate('participants', 'username displayName avatar')
    .populate('lastMessage')
    .populate('createdBy', 'username displayName');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    res.json({ chat });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update chat
router.put('/:chatId', [
  body('name').optional().isLength({ max: 100 }),
  body('description').optional().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { chatId } = req.params;
    const userId = req.userId;
    const { name, description } = req.body;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Only creator can update group chats
    if (chat.type === 'group' && chat.createdBy.toString() !== userId) {
      return res.status(403).json({ message: 'Only chat creator can update' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      updateData,
      { new: true }
    )
    .populate('participants', 'username displayName avatar')
    .populate('lastMessage')
    .populate('createdBy', 'username displayName');

    res.json({ chat: updatedChat });
  } catch (error) {
    console.error('Update chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete chat (leave for group, delete for private)
router.delete('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    if (chat.type === 'private') {
      // Deactivate private chat
      chat.isActive = false;
      await chat.save();
    } else {
      // Remove user from group chat
      chat.participants = chat.participants.filter(
        p => p.toString() !== userId
      );
      
      if (chat.participants.length === 0) {
        chat.isActive = false;
      }
      
      await chat.save();
    }

    res.json({ message: 'Chat left successfully' });
  } catch (error) {
    console.error('Leave chat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get messages for a chat
router.get('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const skip = (page - 1) * limit;

    const messages = await Message.find({
      chat: chatId,
      isDeleted: false
    })
    .populate('sender', 'username displayName avatar')
    .populate('replyTo')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    res.json({ 
      messages: messages.reverse(),
      hasMore: messages.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Mark messages as read
router.put('/:chatId/read', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;

    // Verify user is participant
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const now = new Date();

    // Mark all messages in this chat as read by this user
    await Message.updateMany(
      { 
        chat: chatId,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId }
      },
      { 
        $push: { readBy: { user: userId, readAt: now } }
      }
    );

    // Upsert lastReadBy in chat
    await Chat.updateOne(
      { _id: chatId, participants: userId },
      {
        $setOnInsert: { lastReadBy: [] },
      }
    );

    const chatDoc = await Chat.findOne({ _id: chatId, participants: userId });
    if (chatDoc) {
      const idx = (chatDoc.lastReadBy || []).findIndex(e => e.user.toString() === userId);
      if (idx >= 0) {
        chatDoc.lastReadBy[idx].at = now;
      } else {
        chatDoc.lastReadBy.push({ user: userId, at: now });
      }
      await chatDoc.save();
    }

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark messages as read error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Unread counts per chat for current user
router.get('/unread-counts', async (req, res) => {
  try {
    const userId = req.userId;
    const chats = await Chat.find({ participants: userId, isActive: true })
      .select('_id lastReadBy');

    const counts = {};
    for (const c of chats) {
      const entry = (c.lastReadBy || []).find(e => e.user && e.user.toString() === userId);
      const lastReadAt = entry?.at || new Date(0);
      const count = await Message.countDocuments({
        chat: c._id,
        createdAt: { $gt: lastReadAt },
        sender: { $ne: userId },
        isDeleted: { $ne: true }
      });
      counts[c._id] = count;
    }
    res.json({ counts });
  } catch (error) {
    console.error('Get unread counts error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


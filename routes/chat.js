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
    .populate('participants', 'username displayName avatar avatarUpdatedAt')
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
      .populate('participants', 'username displayName avatar avatarUpdatedAt')
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
      }).populate('participants', 'username displayName avatar avatarUpdatedAt isOnline lastSeen');

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
    await chat.populate('participants', 'username displayName avatar avatarUpdatedAt isOnline lastSeen');
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
    .populate('participants', 'username displayName avatar avatarUpdatedAt')
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
    .populate('participants', 'username displayName avatar avatarUpdatedAt')
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
      isDeleted: false,
      hiddenBy: { $ne: userId }
    })
    .populate('sender', 'username displayName avatar avatarUpdatedAt')
    .populate({
      path: 'replyTo',
      select: 'content type imageUrl sender createdAt',
      populate: { path: 'sender', select: 'username displayName avatar avatarUpdatedAt' }
    })
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

module.exports = router;

// ============================
// Message-level actions (Telegram-like)
// ============================

// React/unreact to a message (one reaction per user)
router.post('/:chatId/messages/:messageId/react', [
  body('emoji').isString().isLength({ min: 1, max: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { chatId, messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.userId;

    // Verify user is participant
    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const message = await Message.findOne({ _id: messageId, chat: chatId, isDeleted: false });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Toggle logic: if same emoji by this user already exists, remove it (unreact).
    // Otherwise replace any existing reaction by this user with the new emoji.
    const current = message.reactions || [];
    const hadSame = current.some(r => r.user.toString() === userId && r.emoji === emoji);
    // Remove all previous reactions by this user
    message.reactions = current.filter(r => r.user.toString() !== userId);
    if (!hadSame) {
      // Add new emoji only if it wasn't the same one (i.e., not unreact)
      message.reactions.push({ user: userId, emoji });
    }
    await message.save();

    const io = req.app.get('io');
    const payload = { chatId, messageId, userId, emoji };
    io && io.to(`chat_${chatId}`).emit('message_reaction', payload);

    res.json({ success: true, reactions: message.reactions });
  } catch (error) {
    console.error('React message error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Hide message for me (delete for me)
router.put('/:chatId/messages/:messageId/hide', async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const message = await Message.findOne({ _id: messageId, chat: chatId });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const already = (message.hiddenBy || []).some(id => id.toString() === userId);
    if (!already) {
      message.hiddenBy = [...(message.hiddenBy || []), userId];
      await message.save();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Hide message error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete message for everyone (only sender)
router.delete('/:chatId/messages/:messageId', async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const message = await Message.findOne({ _id: messageId, chat: chatId });
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.sender.toString() !== userId) return res.status(403).json({ message: 'Not allowed' });

    // Use atomic update to avoid validators on unrelated fields
    const result = await Message.updateOne(
      { _id: messageId, chat: chatId, sender: userId },
      {
        $set: { isDeleted: true, reactions: [] },
        $unset: { imageUrl: "", fileUrl: "" }
      }
    );
    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: 'Nothing changed' });
    }

    const io = req.app.get('io');
    io && io.to(`chat_${chatId}`).emit('message_deleted', { chatId, messageId });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Pin a message in chat
router.put('/:chatId/pin/:messageId', async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const exists = (chat.pinnedMessages || []).some(pm => pm.message.toString() === messageId);
    if (!exists) {
      chat.pinnedMessages = [
        ...(chat.pinnedMessages || []),
        { message: messageId, pinnedBy: userId, pinnedAt: new Date() }
      ];
      await chat.save();
    }

    const io = req.app.get('io');
    io && io.to(`chat_${chatId}`).emit('message_pinned', { chatId, messageId });

    res.json({ success: true });
  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Unpin a message in chat
router.delete('/:chatId/pin/:messageId', async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    chat.pinnedMessages = (chat.pinnedMessages || []).filter(pm => pm.message.toString() !== messageId);
    await chat.save();

    const io = req.app.get('io');
    io && io.to(`chat_${chatId}`).emit('message_unpinned', { chatId, messageId });

    res.json({ success: true });
  } catch (error) {
    console.error('Unpin message error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get pinned messages
router.get('/:chatId/pins', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;

    const chat = await Chat.findOne({ _id: chatId, participants: userId, isActive: true })
      .populate({
        path: 'pinnedMessages.message',
        populate: [
          { path: 'sender', select: 'username displayName avatar' },
        ]
      });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    res.json({ pinned: chat.pinnedMessages || [] });
  } catch (error) {
    console.error('Get pins error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


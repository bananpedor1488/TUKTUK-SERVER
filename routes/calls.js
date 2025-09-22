const express = require('express');
const mongoose = require('mongoose');
const Call = require('../models/Call');
const Chat = require('../models/Chat');
const User = require('../models/User');
const router = express.Router();

// Auth in this project is via middleware/auth.authenticateToken which sets req.userId
const ensureAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ message: 'Not authorized' });
  next();
};

// POST /api/calls/initiate
router.post('/initiate', ensureAuth, async (req, res) => {
  try {
    const { chatId, type = 'audio' } = req.body;
    const callerId = req.userId;

    if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: 'chatId is required' });
    }

    const chat = await Chat.findById(chatId).populate('participants', 'username displayName avatar');
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const isMember = chat.participants.some(p => p._id.toString() === callerId);
    if (!isMember) return res.status(403).json({ message: 'Access denied' });

    const callee = chat.participants.find(p => p._id.toString() !== callerId);
    if (!callee) return res.status(400).json({ message: 'Callee not found' });

    // Check existing active calls for either user
    const active = await Call.findOne({
      $or: [
        { caller: callerId, status: { $in: ['pending', 'accepted'] } },
        { callee: callerId, status: { $in: ['pending', 'accepted'] } },
        { caller: callee._id, status: { $in: ['pending', 'accepted'] } },
        { callee: callee._id, status: { $in: ['pending', 'accepted'] } }
      ]
    });
    if (active) {
      return res.status(409).json({ message: 'User is already in a call', activeCallId: active._id, status: active.status });
    }

    const newCall = await Call.create({ caller: callerId, callee: callee._id, chat: chatId, type });

    const populatedCall = await Call.findById(newCall._id)
      .populate('caller', 'username displayName avatar')
      .populate('callee', 'username displayName avatar')
      .populate('chat');

    // Notify via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${callee._id}`).emit('incomingCall', {
        callId: populatedCall._id,
        caller: populatedCall.caller,
        type: populatedCall.type,
        chat: populatedCall.chat
      });
      io.to(`user_${callerId}`).emit('callInitiated', {
        callId: populatedCall._id,
        caller: populatedCall.caller,
        callee: populatedCall.callee,
        type: populatedCall.type,
        chat: populatedCall.chat
      });
    }

    res.status(201).json({ callId: populatedCall._id, status: 'initiated', callee: populatedCall.callee, type: populatedCall.type });
  } catch (err) {
    console.error('Error initiating call:', err);
    res.status(500).json({ message: 'Error initiating call' });
  }
});

// POST /api/calls/cleanup - ends all pending/accepted calls for current user
router.post('/cleanup', ensureAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const now = new Date();
    const activeCalls = await Call.find({
      $or: [
        { caller: userId, status: { $in: ['pending', 'accepted'] } },
        { callee: userId, status: { $in: ['pending', 'accepted'] } }
      ]
    });

    if (!activeCalls || activeCalls.length === 0) {
      return res.json({ success: true, cleaned: 0 });
    }

    const io = req.app.get('io');
    let cleaned = 0;

    for (const call of activeCalls) {
      let duration = 0;
      if (call.startedAt) duration = Math.floor((now - call.startedAt) / 1000);
      call.status = 'ended';
      call.endedAt = now;
      call.duration = duration;
      await call.save();
      cleaned++;

      if (io) {
        io.to(`user_${call.caller}`).emit('callEnded', { callId: call._id, endedBy: { _id: userId }, duration });
        io.to(`user_${call.callee}`).emit('callEnded', { callId: call._id, endedBy: { _id: userId }, duration });
      }
    }

    res.json({ success: true, cleaned });
  } catch (err) {
    console.error('Error cleaning up calls:', err);
    res.status(500).json({ message: 'Error cleaning up calls' });
  }
});

// POST /api/calls/accept/:callId
router.post('/accept/:callId', ensureAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.userId;

    const call = await Call.findById(callId).populate('caller', 'username displayName avatar').populate('callee', 'username displayName avatar');
    if (!call) return res.status(404).json({ message: 'Call not found' });
    if (call.callee._id.toString() !== userId) return res.status(403).json({ message: 'Access denied' });
    if (call.status !== 'pending') return res.status(400).json({ message: 'Call is not pending' });

    call.status = 'accepted';
    call.startedAt = new Date();
    await call.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${call.caller._id}`).emit('callAccepted', { callId: call._id, acceptedBy: call.callee });
      io.to(`user_${call.callee._id}`).emit('callAccepted', { callId: call._id, acceptedBy: call.callee });
    }

    res.json({ callId: call._id, status: 'accepted', startedAt: call.startedAt });
  } catch (err) {
    console.error('Error accepting call:', err);
    res.status(500).json({ message: 'Error accepting call' });
  }
});

// POST /api/calls/decline/:callId
router.post('/decline/:callId', ensureAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.userId;

    const call = await Call.findById(callId).populate('caller', 'username displayName avatar').populate('callee', 'username displayName avatar');
    if (!call) return res.status(404).json({ message: 'Call not found' });
    if (call.callee._id.toString() !== userId) return res.status(403).json({ message: 'Access denied' });
    if (call.status !== 'pending') return res.status(400).json({ message: 'Call is not pending' });

    call.status = 'declined';
    call.endedAt = new Date();
    await call.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${call.caller._id}`).emit('callDeclined', { callId: call._id, declinedBy: call.callee });
    }

    res.json({ callId: call._id, status: 'declined' });
  } catch (err) {
    console.error('Error declining call:', err);
    res.status(500).json({ message: 'Error declining call' });
  }
});

// POST /api/calls/end/:callId
router.post('/end/:callId', ensureAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.userId;

    const call = await Call.findById(callId).populate('caller', 'username displayName avatar').populate('callee', 'username displayName avatar');
    if (!call) return res.status(404).json({ message: 'Call not found' });

    const participant = [call.caller._id.toString(), call.callee._id.toString()].includes(userId);
    if (!participant) return res.status(403).json({ message: 'Access denied' });

    const endTime = new Date();
    let duration = 0;
    if (call.startedAt) duration = Math.floor((endTime - call.startedAt) / 1000);

    call.status = 'ended';
    call.endedAt = endTime;
    call.duration = duration;
    await call.save();

    const io = req.app.get('io');
    if (io) {
      const endedByUser = userId === call.caller._id.toString() ? call.caller : call.callee;
      io.to(`user_${call.caller._id}`).emit('callEnded', { callId: call._id, endedBy: endedByUser, duration });
      io.to(`user_${call.callee._id}`).emit('callEnded', { callId: call._id, endedBy: endedByUser, duration });
    }

    res.json({ callId: call._id, status: 'ended', duration });
  } catch (err) {
    console.error('Error ending call:', err);
    res.status(500).json({ message: 'Error ending call' });
  }
});

// GET /api/calls/active
router.get('/active', ensureAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const active = await Call.findOne({
      $or: [
        { caller: userId, status: { $in: ['pending', 'accepted'] } },
        { callee: userId, status: { $in: ['pending', 'accepted'] } }
      ]
    }).populate('caller', 'username displayName avatar').populate('callee', 'username displayName avatar').populate('chat');
    res.json(active);
  } catch (err) {
    console.error('Error fetching active call:', err);
    res.status(500).json({ message: 'Error fetching active call' });
  }
});

// GET /api/calls/history/:chatId
router.get('/history/:chatId', ensureAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    const isMember = chat.participants.some(p => p.toString() === req.userId);
    if (!isMember) return res.status(403).json({ message: 'Access denied' });

    const calls = await Call.find({ chat: chatId })
      .populate('caller', 'username displayName avatar')
      .populate('callee', 'username displayName avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json(calls);
  } catch (err) {
    console.error('Error fetching call history:', err);
    res.status(500).json({ message: 'Error fetching call history' });
  }
});

module.exports = router;

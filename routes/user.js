const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const router = express.Router();

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', [
  body('displayName').optional().isLength({ min: 1, max: 50 }).trim(),
  body('bio').optional().isLength({ max: 200 }).trim(),
  body('username').optional().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { displayName, bio, username } = req.body;

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (username !== undefined) {
      // Check if username is already taken
      const existingUser = await User.findOne({ 
        username, 
        _id: { $ne: userId } 
      });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      updateData.username = username;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    );

    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Search users
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { displayName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ],
      _id: { $ne: req.userId } // Exclude current user
    })
    .select('username displayName avatar isOnline lastSeen')
    .limit(parseInt(limit));

    res.json({ users });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get user by ID
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('username displayName avatar isOnline lastSeen bio');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user avatar
router.put('/avatar', [
  body('avatar').isString().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { avatar } = req.body;

    // Validate base64 image format
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ message: 'Invalid image format' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { avatar },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ 
      user: user.toJSON(),
      message: 'Avatar updated successfully'
    });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update online status
router.put('/status', [
  body('isOnline').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { isOnline } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { 
        isOnline,
        lastSeen: new Date()
      },
      { new: true }
    );

    res.json({ 
      user: user.toJSON(),
      message: `Status updated to ${isOnline ? 'online' : 'offline'}`
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


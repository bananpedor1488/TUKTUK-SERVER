const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { imgbbUploader } = require('../utils/imgbbUpload');

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
    .select('username displayName avatar')
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
      .select('username displayName avatar bio');
    
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


// Upload avatar to ImgBB
router.post('/upload-avatar', async (req, res) => {
  try {
    const userId = req.userId;
    const { base64Data, fileName } = req.body;

    if (!base64Data) {
      return res.status(400).json({ message: 'Base64 data is required' });
    }

    // Check if ImgBB is configured
    if (!imgbbUploader.isConfigured()) {
      return res.status(500).json({ 
        message: 'Image upload service is not configured',
        error: 'IMGBB_API_KEY not set'
      });
    }

    console.log(`📤 Uploading avatar for user ${userId}`);

    // Upload to ImgBB
    const uploadResult = await imgbbUploader.uploadBase64(
      base64Data, 
      fileName || `avatar_${userId}_${Date.now()}.png`
    );

    // Update user avatar in database
    const user = await User.findByIdAndUpdate(
      userId,
      { avatar: uploadResult.url },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`✅ Avatar uploaded successfully for user ${userId}`);

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatar: uploadResult.url,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('❌ Avatar upload error:', error);
    res.status(500).json({ 
      message: 'Avatar upload failed',
      error: error.message
    });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const userId = req.userId;
    const { displayName, username, bio } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Валидация данных
    const updateData = {};
    
    if (displayName !== undefined) {
      if (displayName.length > 50) {
        return res.status(400).json({ message: 'Display name cannot exceed 50 characters' });
      }
      updateData.displayName = displayName.trim();
    }
    
    if (username !== undefined) {
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ message: 'Username must be between 3 and 20 characters' });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ message: 'Username can only contain letters, numbers and underscores' });
      }
      
      // Проверяем, что username не занят
      const existingUser = await User.findOne({ 
        username: username, 
        _id: { $ne: userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username is already taken' });
      }
      
      updateData.username = username.trim();
    }
    
    if (bio !== undefined) {
      if (bio.length > 160) {
        return res.status(400).json({ message: 'Bio cannot exceed 160 characters' });
      }
      updateData.bio = bio.trim();
    }

    // Обновляем пользователя
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('username displayName bio avatar email');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`✅ Profile updated for user ${userId}:`, updateData);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser.toJSON()
    });

  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({ 
      message: 'Profile update failed',
      error: error.message
    });
  }
});

// Get ImgBB upload status
router.get('/upload-status', async (req, res) => {
  try {
    const stats = imgbbUploader.getStats();
    res.json({
      configured: stats.configured,
      maxFileSize: stats.maxFileSize,
      supportedTypes: stats.supportedTypes,
      message: stats.configured ? 'Upload service ready' : 'Upload service not configured'
    });
  } catch (error) {
    console.error('Upload status error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;


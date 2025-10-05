const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { imgbbUploader } = require('../utils/imgbbUpload');
const { uploadSingle, handleUploadError } = require('../middleware/upload');

const router = express.Router();

  // Get user profile
  router.get('/profile', async (req, res) => {
    try {
      const userId = req.userId;
      const user = await User.findById(userId).select('username displayName bio avatar avatarUpdatedAt email bannerImage bannerColor');
      
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
    body('username').optional().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    body('bannerColor').optional().isString().isLength({ max: 30 }).trim(),
    // base64 data URLs can be large; just ensure it's a string
    body('bannerImage').optional().isString()
  ], async (req, res) => {
    try {
      console.log('📤 Profile update request received:', {
        body: req.body,
        userId: req.userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('❌ Validation errors:', errors.array());
        return res.status(400).json({ 
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const userId = req.userId;
      const { displayName, bio, username, bannerColor, bannerImage } = req.body;

      if (!userId) {
        return res.status(401).json({ 
          success: false,
          message: 'User not authenticated' 
        });
      }

      // Additional security checks
      if (username && username.toLowerCase() === 'admin') {
        console.log('❌ Reserved username attempt:', username);
        return res.status(400).json({ 
          success: false,
          message: 'This username is reserved' 
        });
      }

      const updateData = {};
      if (displayName !== undefined) updateData.displayName = displayName.trim();
      if (bio !== undefined) updateData.bio = bio.trim();
      if (bannerColor !== undefined) updateData.bannerColor = bannerColor.trim();
      if (bannerImage !== undefined) updateData.bannerImage = bannerImage;
      if (username !== undefined) {
        const trimmedUsername = username.trim();
        
        // First, get the current user to check if they're trying to keep their current username
        const currentUser = await User.findById(userId);
        if (!currentUser) {
          console.log('❌ Current user not found:', userId);
          return res.status(404).json({ 
            success: false,
            message: 'User not found' 
          });
        }
        
        // If the username is the same as current, allow it
        if (currentUser.username === trimmedUsername) {
          console.log('✅ Username unchanged, allowing:', trimmedUsername);
          updateData.username = trimmedUsername;
        } else {
          // Check if new username is already taken by another user
          const existingUser = await User.findOne({ 
            username: trimmedUsername, 
            _id: { $ne: userId } 
          });
          if (existingUser) {
            // Check if this username was previously used by the current user
            const wasPreviousUsername = currentUser.previousUsernames && 
              currentUser.previousUsernames.some(prev => prev.username === trimmedUsername);
            
            if (wasPreviousUsername) {
              console.log('✅ Username was previously used by this user, allowing:', trimmedUsername);
              updateData.username = trimmedUsername;
            } else {
              console.log('❌ Username already taken:', { 
                username: trimmedUsername, 
                existingUserId: existingUser._id,
                currentUserId: userId 
              });
              return res.status(400).json({ 
                success: false,
                message: 'Username already taken' 
              });
            }
          } else {
            console.log('✅ New username available:', trimmedUsername);
            updateData.username = trimmedUsername;
          }
        }
      }

      const user = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, runValidators: true }
      ).select('username displayName bio avatar avatarUpdatedAt email bannerImage bannerColor');

      if (!user) {
        console.log('❌ User not found:', userId);
        return res.status(404).json({ 
          success: false,
          message: 'User not found' 
        });
      }

      // If username was changed, save the previous username to history
      if (updateData.username && currentUser.username !== updateData.username) {
        try {
          await User.findByIdAndUpdate(userId, {
            $push: {
              previousUsernames: {
                username: currentUser.username,
                changedAt: new Date()
              }
            }
          });
          console.log('✅ Previous username saved to history:', currentUser.username);
        } catch (historyError) {
          console.error('❌ Error saving username history:', historyError);
          // Don't fail the request if history saving fails
        }
      }

      console.log(`✅ Profile updated for user ${userId}:`, {
        ...updateData,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });

      // Generate new JWT tokens if username changed
      let newTokens = null;
      if (updateData.username) {
        try {
          // Generate new access token
          const accessToken = jwt.sign(
            { 
              userId: user._id, 
              username: user.username,
              email: user.email 
            },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: '15m' }
          );
          
          // Generate new refresh token
          const refreshToken = jwt.sign(
            { 
              userId: user._id, 
              username: user.username,
              email: user.email 
            },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
          );
          
          // Update refresh token in database
          await RefreshToken.findOneAndUpdate(
            { userId: user._id },
            { 
              token: refreshToken,
              username: user.username, // Update username in refresh token record
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            },
            { upsert: true }
          );
          
          newTokens = {
            accessToken,
            refreshToken
          };
          
          console.log(`🔄 Generated new tokens for user ${userId} due to username change`);
        } catch (tokenError) {
          console.error('❌ Error generating new tokens:', tokenError);
          // Don't fail the entire request if token generation fails
        }
      }

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: user.toJSON(),
        ...(newTokens && { tokens: newTokens })
      });
    } catch (error) {
      console.error('❌ Update profile error:', error);
      res.status(500).json({ 
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  });

  // Upload banner image as base64 and save to user
  router.post('/upload-banner', [
    body('base64Data').isString().isLength({ min: 1 }),
    body('fileName').optional().isString().isLength({ max: 100 }).trim()
  ], async (req, res) => {
    try {
      const userId = req.userId;
      const { base64Data, fileName } = req.body;

      if (!base64Data) {
        return res.status(400).json({ message: 'Base64 data is required' });
      }

      // Normalize to data URL if raw base64 without header was provided
      const dataUrl = base64Data.startsWith('data:image/')
        ? base64Data
        : `data:image/png;base64,${base64Data}`;

      const user = await User.findByIdAndUpdate(
        userId,
        { bannerImage: dataUrl },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      console.log(`✅ Banner saved (base64) for user ${userId}`);

      res.json({
        success: true,
        message: 'Banner saved successfully',
        banner: user.bannerImage,
        user: user.toJSON()
      });
    } catch (error) {
      console.error('❌ Banner upload error:', error);
      res.status(500).json({ 
        message: 'Banner save failed',
        error: error.message 
      });
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
    .select('username displayName avatar avatarUpdatedAt')
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
      .select('username displayName avatar avatarUpdatedAt bio bannerImage bannerColor');
    
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
      { avatar, avatarUpdatedAt: new Date() },
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


// Upload avatar as base64 and save to user
router.post('/upload-avatar', async (req, res) => {
  try {
    const userId = req.userId;
    const { base64Data, fileName } = req.body;

    if (!base64Data) {
      return res.status(400).json({ message: 'Base64 data is required' });
    }

    console.log(`📤 Saving avatar (base64) for user ${userId}`);

    // Normalize to data URL if raw base64 without header was provided
    const dataUrl = base64Data.startsWith('data:image/')
      ? base64Data
      : `data:image/png;base64,${base64Data}`;

    // Update user avatar in database
    const user = await User.findByIdAndUpdate(
      userId,
      { avatar: dataUrl, avatarUpdatedAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`✅ Avatar saved (base64) for user ${userId}`);

    res.json({
      success: true,
      message: 'Avatar saved successfully',
      avatar: user.avatar,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('❌ Avatar upload error:', error);
    res.status(500).json({ 
      message: 'Avatar save failed',
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

// Upload file to ImgBB (for photos, documents, etc.)
router.post('/upload-file', uploadSingle, handleUploadError, async (req, res) => {
  try {
    const userId = req.userId;

    // Check if ImgBB is configured
    if (!imgbbUploader.isConfigured()) {
      return res.status(500).json({ 
        message: 'Image upload service is not configured',
        error: 'IMGBB_API_KEY not set'
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    console.log(`📤 Uploading file for user ${userId}:`, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    // Convert buffer to base64
    const base64Data = file.buffer.toString('base64');
    const fileName = file.originalname || `file_${userId}_${Date.now()}.${file.mimetype.split('/')[1]}`;

    // Upload to ImgBB
    const uploadResult = await imgbbUploader.uploadBase64(
      base64Data, 
      fileName
    );

    console.log(`✅ File uploaded successfully for user ${userId}`);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      imageUrl: uploadResult.url,
      fileName: fileName,
      fileType: file.mimetype,
      fileSize: file.size
    });

  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ 
      message: 'Failed to upload file',
      error: error.message 
    });
  }
});

module.exports = router;


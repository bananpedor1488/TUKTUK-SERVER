const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { generateTokens, saveRefreshToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9._-]+$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        error: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password, username } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ 
          success: false,
          error: 'Эта электронная почта уже зарегистрирована. Попробуйте войти или восстановить пароль.'
        });
      } else {
        return res.status(400).json({ 
          success: false,
          error: 'Это имя пользователя уже занято. Пожалуйста, выберите другое.'
        });
      }
    }

    // Create new user
    const user = new User({
      email,
      password,
      username,
      displayName: username // Use username as displayName initially
    });

    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await saveRefreshToken(user._id, refreshToken);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 24 * 60 * 60 * 1000 // 60 days
    });

    res.status(201).json({
      success: true,
      message: 'Регистрация успешна! Теперь вы можете создать профиль.',
      user: user.toJSON(),
      accessToken
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при регистрации. Пожалуйста, попробуйте позже.'
    });
  }
});

// Login
router.post('/login', [
  body('username').notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        error: 'Validation failed',
        errors: errors.array()
      });
    }

    const { username, password } = req.body;

    // Find user by email or username
    const user = await User.findOne({
      $or: [{ email: username }, { username: username }]
    });
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверное имя пользователя или пароль'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверное имя пользователя или пароль'
      });
    }

    // Update online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await saveRefreshToken(user._id, refreshToken);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 24 * 60 * 60 * 1000 // 60 days
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: user.toJSON(),
      accessToken
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при входе в систему'
    });
  }
});

// Register Profile
router.post('/register-profile', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: 'Вы не авторизованы для создания профиля'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const { name, interests, about, referral_code } = req.body;

    // Update user profile
    user.displayName = name || user.displayName;
    user.interests = interests || '';
    user.about = about || '';
    user.referralCode = referral_code || '';

    // Handle avatar upload if provided
    if (req.file) {
      user.avatar = req.file.path;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Профиль создан успешно',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Profile registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при создании профиля'
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      // Revoke refresh token
      await RefreshToken.findOneAndUpdate(
        { token: refreshToken },
        { isRevoked: true }
      );
    }

    // Clear cookie
    res.clearCookie('refreshToken');
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    console.log('🔄 Refresh token request:', {
      hasRefreshToken: !!refreshToken,
      refreshToken: refreshToken ? refreshToken.substring(0, 20) + '...' : 'none',
      cookies: Object.keys(req.cookies)
    });
    
    if (!refreshToken) {
      console.log('❌ No refresh token in cookies');
      return res.status(401).json({ message: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    console.log('✅ Refresh token decoded for user:', decoded.userId);
    
    // Check if refresh token exists in database
    const tokenDoc = await RefreshToken.findOne({
      token: refreshToken,
      user: decoded.userId,
      isRevoked: false
    });

    if (!tokenDoc) {
      console.log('❌ Refresh token not found in database or revoked');
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    // Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      console.log('❌ User not found for refresh:', decoded.userId);
      return res.status(401).json({ message: 'User not found' });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    await saveRefreshToken(user._id, newRefreshToken);

    // Set new refresh token as HTTP-only cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 24 * 60 * 60 * 1000 // 60 days
    });

    console.log('✅ New tokens generated for user:', user.email);
    res.json({
      message: 'Token refreshed successfully',
      accessToken
    });

  } catch (error) {
    console.error('❌ Refresh token error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Refresh token expired' });
    }
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// Telegram Login
router.post('/telegram', async (req, res) => {
  try {
    const { chat_id, username, first_name, last_name, photo_url } = req.body;

    if (!chat_id) {
      return res.status(400).json({ 
        success: false,
        error: 'Telegram chat_id is required'
      });
    }

    // Check if user already exists by telegramId
    let user = await User.findOne({ telegramId: chat_id });

    if (user) {
      // Update user info if needed
      if (username && user.username !== username) {
        user.username = username;
      }
      if (first_name && user.displayName !== first_name) {
        user.displayName = first_name;
      }
      if (photo_url && user.avatar !== photo_url) {
        user.avatar = photo_url;
      }
      
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
    } else {
      // Create new user
      const displayName = first_name || username || `User${chat_id}`;
      const generatedUsername = username || `telegram_${chat_id}`;
      
      // Ensure username is unique
      let finalUsername = generatedUsername;
      let counter = 1;
      while (await User.findOne({ username: finalUsername })) {
        finalUsername = `${generatedUsername}_${counter}`;
        counter++;
      }

      user = new User({
        telegramId: chat_id,
        username: finalUsername,
        displayName: displayName,
        email: `${chat_id}@telegram.local`, // Placeholder email
        password: 'telegram_auth', // Placeholder password
        avatar: photo_url,
        isOnline: true,
        lastSeen: new Date()
      });

      await user.save();
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await saveRefreshToken(user._id, refreshToken);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 24 * 60 * 60 * 1000 // 60 days
    });

    res.json({
      success: true,
      message: 'Telegram authentication successful',
      user: user.toJSON(),
      accessToken,
      refreshToken
    });

  } catch (error) {
    console.error('Telegram auth error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка при авторизации через Telegram'
    });
  }
});

// Telegram callback (for widget)
router.get('/telegram-callback', async (req, res) => {
  try {
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.query;

    if (!id) {
      return res.status(400).send('Invalid Telegram data');
    }

    // Verify the data (in production, you should verify the hash)
    // For now, we'll trust the data from Telegram

    // Check if user already exists
    let user = await User.findOne({ telegramId: id });

    if (user) {
      // Update user info
      if (username && user.username !== username) {
        user.username = username;
      }
      if (first_name && user.displayName !== first_name) {
        user.displayName = first_name;
      }
      if (photo_url && user.avatar !== photo_url) {
        user.avatar = photo_url;
      }
      
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
    } else {
      // Create new user
      const displayName = first_name || username || `User${id}`;
      const generatedUsername = username || `telegram_${id}`;
      
      // Ensure username is unique
      let finalUsername = generatedUsername;
      let counter = 1;
      while (await User.findOne({ username: finalUsername })) {
        finalUsername = `${generatedUsername}_${counter}`;
        counter++;
      }

      user = new User({
        telegramId: id,
        username: finalUsername,
        displayName: displayName,
        email: `${id}@telegram.local`,
        password: 'telegram_auth',
        avatar: photo_url,
        isOnline: true,
        lastSeen: new Date()
      });

      await user.save();
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await saveRefreshToken(user._id, refreshToken);

    // Redirect to frontend with tokens
    const redirectUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/telegram-success?token=${accessToken}&refresh=${refreshToken}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Telegram callback error:', error);
    res.status(500).send('Authentication error');
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log('🔍 /auth/me endpoint:', {
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      authHeader: authHeader ? authHeader.substring(0, 20) + '...' : 'none'
    });

    if (!token) {
      console.log('❌ No token provided to /auth/me');
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log('✅ Token decoded for user:', decoded.userId);
    
    const user = await User.findById(decoded.userId);

    if (!user) {
      console.log('❌ User not found:', decoded.userId);
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('✅ User found:', user.email);
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('❌ Get user error:', error.message);
    res.status(401).json({ message: 'Invalid token' });
  }
});

module.exports = router;


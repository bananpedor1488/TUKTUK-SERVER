const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    console.log('🔐 Middleware authenticateToken:', {
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      url: req.url,
      method: req.method
    });

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log('✅ Token decoded successfully:', { userId: decoded.userId });
    
    // Check if refresh token exists and is not revoked
    const refreshToken = await RefreshToken.findOne({
      user: decoded.userId,
      isRevoked: false
    });

    console.log('🔄 Refresh token check:', { 
      userId: decoded.userId, 
      hasRefreshToken: !!refreshToken,
      isRevoked: refreshToken?.isRevoked
    });

    if (!refreshToken) {
      console.log('❌ No valid refresh token found');
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.userId = decoded.userId;
    console.log('✅ Authentication successful for user:', decoded.userId);
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(403).json({ message: 'Invalid token' });
  }
};

const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId, timestamp: Date.now() },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '30d' }
  );

  const refreshToken = jwt.sign(
    { userId, timestamp: Date.now(), random: Math.random() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '60d' }
  );

  return { accessToken, refreshToken };
};

const saveRefreshToken = async (userId, refreshToken) => {
  try {
    // Revoke all existing refresh tokens for this user
    await RefreshToken.updateMany(
      { user: userId },
      { isRevoked: true }
    );

    // Check if this exact token already exists
    const existingToken = await RefreshToken.findOne({ token: refreshToken });
    if (existingToken) {
      // If it exists, just update it instead of creating a new one
      existingToken.isRevoked = false;
      existingToken.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      await existingToken.save();
      return existingToken;
    }

    // Save new refresh token
    const tokenDoc = new RefreshToken({
      token: refreshToken,
      user: userId,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
    });

    await tokenDoc.save();
    return tokenDoc;
  } catch (error) {
    // If there's a duplicate key error, try to find and update the existing token
    if (error.code === 11000) {
      const existingToken = await RefreshToken.findOne({ token: refreshToken });
      if (existingToken) {
        existingToken.isRevoked = false;
        existingToken.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        await existingToken.save();
        return existingToken;
      }
    }
    throw error;
  }
};

module.exports = {
  authenticateToken,
  generateTokens,
  saveRefreshToken
};


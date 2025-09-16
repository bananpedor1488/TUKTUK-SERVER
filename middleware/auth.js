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
      method: req.method,
      authHeader: authHeader ? authHeader.substring(0, 20) + '...' : 'none',
      tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
      timestamp: new Date().toISOString()
    });

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ message: 'Access token required' });
    }

    // Проверяем, что JWT_SECRET существует
    if (!process.env.JWT_ACCESS_SECRET) {
      console.log('❌ JWT_ACCESS_SECRET not configured');
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log('✅ Token decoded successfully:', { 
      userId: decoded.userId,
      timestamp: decoded.timestamp,
      tokenAge: Date.now() - decoded.timestamp
    });
    
    // Check if refresh token exists and is not revoked
    const refreshToken = await RefreshToken.findOne({
      user: decoded.userId,
      isRevoked: false
    });

    console.log('🔄 Refresh token check:', { 
      userId: decoded.userId, 
      hasRefreshToken: !!refreshToken,
      isRevoked: refreshToken?.isRevoked,
      expiresAt: refreshToken?.expiresAt,
      url: req.url
    });

    if (!refreshToken) {
      console.log('❌ No valid refresh token found for user:', decoded.userId);
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Check if refresh token is expired
    if (refreshToken.expiresAt && refreshToken.expiresAt < new Date()) {
      console.log('❌ Refresh token expired for user:', decoded.userId);
      // Mark as revoked
      refreshToken.isRevoked = true;
      await refreshToken.save();
      return res.status(401).json({ message: 'Token expired' });
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
  console.log('🔑 Generating tokens for user:', userId);
  console.log('🔑 JWT_ACCESS_SECRET exists:', !!process.env.JWT_ACCESS_SECRET);
  console.log('🔑 JWT_REFRESH_SECRET exists:', !!process.env.JWT_REFRESH_SECRET);
  
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

  console.log('🔑 Tokens generated successfully');
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


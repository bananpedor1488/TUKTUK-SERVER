const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    // Проверяем, что JWT_SECRET существует
    if (!process.env.JWT_ACCESS_SECRET) {
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
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
    { expiresIn: '15m' } // Короткий срок жизни access token
  );

  const refreshToken = jwt.sign(
    { userId, timestamp: Date.now(), random: Math.random() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' } // Refresh token на неделю
  );

  return { accessToken, refreshToken };
};

const saveRefreshToken = async (userId, refreshToken) => {
  try {
    // Просто сохраняем новый refresh token
    const tokenDoc = new RefreshToken({
      token: refreshToken,
      user: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 дней
    });

    await tokenDoc.save();
    return tokenDoc;
  } catch (error) {
    // Если токен уже существует, обновляем его
    if (error.code === 11000) {
      const existingToken = await RefreshToken.findOne({ token: refreshToken });
      if (existingToken) {
        existingToken.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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


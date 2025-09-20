const EventEmitter = require('events');
const User = require('../models/User');

/**
 * Professional Online Status Management System
 * Handles user online/offline status with proper persistence and real-time updates
 */
class OnlineStatusManager extends EventEmitter {
  constructor() {
    super();
    
    // In-memory cache for fast access
    this.onlineUsers = new Map(); // userId -> { socketId, lastSeen, username, isOnline }
    
    // Configuration
    this.config = {
      heartbeatInterval: 30000, // 30 seconds
      offlineTimeout: 60000,    // 1 minute
      maxRetries: 3,
      retryDelay: 1000
    };
    
    // Cleanup interval for stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, this.config.offlineTimeout);
    
    console.log('🟢 OnlineStatusManager initialized');
  }

  /**
   * User connects to the system
   * @param {string} userId - User ID
   * @param {string} socketId - Socket ID
   * @param {string} username - Username
   */
  async userConnected(userId, socketId, username) {
    try {
      const now = new Date();
      
      // Update database
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: now,
        socketId: socketId
      });
      
      // Update in-memory cache
      this.onlineUsers.set(userId, {
        socketId,
        username,
        isOnline: true,
        lastSeen: now,
        connectedAt: now
      });
      
      // Emit events
      this.emit('userOnline', {
        userId,
        username,
        lastSeen: now,
        socketId
      });
      
      console.log(`✅ User ${username} (${userId}) connected`);
      
      return {
        success: true,
        lastSeen: now,
        isOnline: true
      };
      
    } catch (error) {
      console.error('❌ Error in userConnected:', error);
      throw error;
    }
  }

  /**
   * User disconnects from the system
   * @param {string} userId - User ID
   */
  async userDisconnected(userId) {
    try {
      const userData = this.onlineUsers.get(userId);
      if (!userData) return;
      
      const now = new Date();
      
      // Update database
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: now,
        socketId: null
      });
      
      // Remove from cache
      this.onlineUsers.delete(userId);
      
      // Emit events
      this.emit('userOffline', {
        userId,
        username: userData.username,
        lastSeen: now
      });
      
      console.log(`❌ User ${userData.username} (${userId}) disconnected`);
      
      return {
        success: true,
        lastSeen: now,
        isOnline: false
      };
      
    } catch (error) {
      console.error('❌ Error in userDisconnected:', error);
      throw error;
    }
  }

  /**
   * Update user activity (heartbeat)
   * @param {string} userId - User ID
   */
  async updateUserActivity(userId) {
    try {
      const userData = this.onlineUsers.get(userId);
      if (!userData) return;
      
      const now = new Date();
      
      // Update database
      await User.findByIdAndUpdate(userId, {
        lastSeen: now
      });
      
      // Update cache
      this.onlineUsers.set(userId, {
        ...userData,
        lastSeen: now
      });
      
      return {
        success: true,
        lastSeen: now
      };
      
    } catch (error) {
      console.error('❌ Error in updateUserActivity:', error);
      throw error;
    }
  }

  /**
   * Get online status for multiple users
   * @param {string[]} userIds - Array of user IDs
   */
  async getUsersStatus(userIds) {
    try {
      const statusMap = {};
      
      // Get from cache first (fastest)
      for (const userId of userIds) {
        const cachedData = this.onlineUsers.get(userId);
        if (cachedData) {
          statusMap[userId] = {
            username: cachedData.username,
            isOnline: cachedData.isOnline,
            lastSeen: cachedData.lastSeen
          };
        }
      }
      
      // Get missing users from database
      const missingUserIds = userIds.filter(id => !statusMap[id]);
      if (missingUserIds.length > 0) {
        const dbUsers = await User.find(
          { _id: { $in: missingUserIds } },
          'username isOnline lastSeen'
        );
        
        dbUsers.forEach(user => {
          statusMap[user._id] = {
            username: user.username,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
          };
        });
      }
      
      return statusMap;
      
    } catch (error) {
      console.error('❌ Error in getUsersStatus:', error);
      throw error;
    }
  }

  /**
   * Get all online users
   */
  getAllOnlineUsers() {
    const onlineUsers = [];
    this.onlineUsers.forEach((data, userId) => {
      if (data.isOnline) {
        onlineUsers.push({
          userId,
          username: data.username,
          lastSeen: data.lastSeen,
          connectedAt: data.connectedAt
        });
      }
    });
    return onlineUsers;
  }

  /**
   * Check if user is online
   * @param {string} userId - User ID
   */
  isUserOnline(userId) {
    const userData = this.onlineUsers.get(userId);
    return userData ? userData.isOnline : false;
  }

  /**
   * Get user status
   * @param {string} userId - User ID
   */
  getUserStatus(userId) {
    const userData = this.onlineUsers.get(userId);
    return userData ? {
      username: userData.username,
      isOnline: userData.isOnline,
      lastSeen: userData.lastSeen
    } : {
      username: null,
      isOnline: false,
      lastSeen: null
    };
  }

  /**
   * Cleanup stale connections
   */
  async cleanupStaleConnections() {
    const now = new Date();
    const staleUsers = [];
    
    this.onlineUsers.forEach((data, userId) => {
      const timeSinceLastSeen = now - data.lastSeen;
      if (timeSinceLastSeen > this.config.offlineTimeout) {
        staleUsers.push(userId);
      }
    });
    
    for (const userId of staleUsers) {
      console.log(`🧹 Cleaning up stale connection for user ${userId}`);
      await this.userDisconnected(userId);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalOnline: this.onlineUsers.size,
      onlineUsers: this.getAllOnlineUsers(),
      cacheSize: this.onlineUsers.size,
      uptime: process.uptime()
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.onlineUsers.clear();
    this.removeAllListeners();
    console.log('🟢 OnlineStatusManager destroyed');
  }
}

module.exports = OnlineStatusManager;

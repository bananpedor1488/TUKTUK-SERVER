const EventEmitter = require('events');

/**
 * Professional System Monitor
 * Monitors system performance, connection health, and provides analytics
 */
class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    
    this.metrics = {
      connections: {
        total: 0,
        active: 0,
        peak: 0,
        average: 0
      },
      messages: {
        total: 0,
        perMinute: 0,
        perHour: 0
      },
      performance: {
        memoryUsage: 0,
        cpuUsage: 0,
        responseTime: 0
      },
      errors: {
        total: 0,
        lastHour: 0,
        types: {}
      }
    };
    
    this.history = {
      connections: [],
      messages: [],
      errors: []
    };
    
    this.config = {
      historySize: 1000,
      updateInterval: 30000, // 30 seconds
      cleanupInterval: 300000 // 5 minutes
    };
    
    // Start monitoring
    this.startMonitoring();
    
    console.log('📊 SystemMonitor initialized');
  }

  /**
   * Start system monitoring
   */
  startMonitoring() {
    // Update metrics every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.updateMetrics();
    }, this.config.updateInterval);
    
    // Cleanup old data every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupHistory();
    }, this.config.cleanupInterval);
  }

  /**
   * Update system metrics
   */
  updateMetrics() {
    const memUsage = process.memoryUsage();
    
    this.metrics.performance.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
    this.metrics.performance.cpuUsage = process.cpuUsage();
    
    // Update connection metrics
    this.metrics.connections.average = this.calculateAverageConnections();
    
    // Emit metrics update
    this.emit('metricsUpdate', this.metrics);
  }

  /**
   * Record user connection
   */
  recordConnection(userId, action = 'connect') {
    const timestamp = new Date();
    
    this.metrics.connections.total++;
    
    if (action === 'connect') {
      this.metrics.connections.active++;
      if (this.metrics.connections.active > this.metrics.connections.peak) {
        this.metrics.connections.peak = this.metrics.connections.active;
      }
    } else if (action === 'disconnect') {
      this.metrics.connections.active = Math.max(0, this.metrics.connections.active - 1);
    }
    
    // Add to history
    this.addToHistory('connections', {
      userId,
      action,
      timestamp,
      activeConnections: this.metrics.connections.active
    });
    
    console.log(`📊 Connection ${action}: ${userId} (Active: ${this.metrics.connections.active})`);
  }

  /**
   * Record message sent
   */
  recordMessage(chatId, userId, messageType = 'text') {
    const timestamp = new Date();
    
    this.metrics.messages.total++;
    
    // Add to history
    this.addToHistory('messages', {
      chatId,
      userId,
      messageType,
      timestamp
    });
    
    // Update per-minute rate
    this.updateMessageRates();
  }

  /**
   * Record error
   */
  recordError(error, context = {}) {
    const timestamp = new Date();
    const errorType = error.constructor.name || 'Unknown';
    
    this.metrics.errors.total++;
    
    if (!this.metrics.errors.types[errorType]) {
      this.metrics.errors.types[errorType] = 0;
    }
    this.metrics.errors.types[errorType]++;
    
    // Add to history
    this.addToHistory('errors', {
      error: error.message,
      type: errorType,
      context,
      timestamp
    });
    
    console.error(`📊 Error recorded: ${errorType} - ${error.message}`);
    
    // Emit error event
    this.emit('error', {
      error,
      context,
      timestamp,
      metrics: this.metrics.errors
    });
  }

  /**
   * Add data to history
   */
  addToHistory(type, data) {
    if (!this.history[type]) {
      this.history[type] = [];
    }
    
    this.history[type].push(data);
    
    // Keep history size manageable
    if (this.history[type].length > this.config.historySize) {
      this.history[type] = this.history[type].slice(-this.config.historySize);
    }
  }

  /**
   * Calculate average connections
   */
  calculateAverageConnections() {
    if (this.history.connections.length === 0) return 0;
    
    const recent = this.history.connections.slice(-60); // Last 60 records
    const sum = recent.reduce((acc, record) => acc + record.activeConnections, 0);
    return Math.round(sum / recent.length);
  }

  /**
   * Update message rates
   */
  updateMessageRates() {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    // Count messages in last minute
    this.metrics.messages.perMinute = this.history.messages.filter(
      msg => msg.timestamp > oneMinuteAgo
    ).length;
    
    // Count messages in last hour
    this.metrics.messages.perHour = this.history.messages.filter(
      msg => msg.timestamp > oneHourAgo
    ).length;
  }

  /**
   * Cleanup old history data
   */
  cleanupHistory() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    Object.keys(this.history).forEach(key => {
      this.history[key] = this.history[key].filter(
        record => record.timestamp > cutoff
      );
    });
    
    console.log('📊 History cleanup completed');
  }

  /**
   * Get system health status
   */
  getHealthStatus() {
    const health = {
      status: 'healthy',
      score: 100,
      issues: []
    };
    
    // Check memory usage
    if (this.metrics.performance.memoryUsage > 500) { // 500MB
      health.score -= 20;
      health.issues.push('High memory usage');
    }
    
    // Check error rate
    const errorRate = this.metrics.errors.total / Math.max(this.metrics.messages.total, 1);
    if (errorRate > 0.01) { // 1% error rate
      health.score -= 30;
      health.issues.push('High error rate');
    }
    
    // Check connection stability
    if (this.metrics.connections.active === 0 && this.metrics.connections.total > 0) {
      health.score -= 10;
      health.issues.push('No active connections');
    }
    
    // Determine status
    if (health.score >= 90) {
      health.status = 'excellent';
    } else if (health.score >= 70) {
      health.status = 'good';
    } else if (health.score >= 50) {
      health.status = 'warning';
    } else {
      health.status = 'critical';
    }
    
    return health;
  }

  /**
   * Get detailed statistics
   */
  getStats() {
    return {
      metrics: this.metrics,
      health: this.getHealthStatus(),
      uptime: process.uptime(),
      timestamp: new Date()
    };
  }

  /**
   * Get real-time dashboard data
   */
  getDashboardData() {
    return {
      connections: {
        active: this.metrics.connections.active,
        peak: this.metrics.connections.peak,
        average: this.metrics.connections.average
      },
      messages: {
        total: this.metrics.messages.total,
        perMinute: this.metrics.messages.perMinute,
        perHour: this.metrics.messages.perHour
      },
      performance: {
        memoryUsage: this.metrics.performance.memoryUsage,
        uptime: process.uptime()
      },
      health: this.getHealthStatus()
    };
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.removeAllListeners();
    console.log('📊 SystemMonitor stopped');
  }
}

module.exports = SystemMonitor;

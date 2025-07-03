const redis = require('redis');
const config = require('./environment');
const logger = require('../utils/logger');

// Create Redis client
let redisClient = null;

// Redis connection configuration
const redisConfig = {
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis: Maximum reconnection attempts reached');
        return new Error('Redis connection failed');
      }
      const delay = Math.min(retries * 100, 3000);
      logger.info(`Redis: Reconnecting in ${delay}ms... (attempt ${retries})`);
      return delay;
    },
    connectTimeout: 10000,
  },
};

// Add password if provided
if (config.redis.password) {
  redisConfig.password = config.redis.password;
}

// Connect to Redis
const connectRedis = async () => {
  try {
    redisClient = redis.createClient(redisConfig);
    
    // Error handling
    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });
    
    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });
    
    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });
    
    redisClient.on('end', () => {
      logger.warn('Redis client disconnected');
    });
    
    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });
    
    // Connect to Redis
    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    
    return redisClient;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    // Don't exit the process, Redis is optional for basic functionality
    return null;
  }
};

// Disconnect from Redis
const disconnectRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.quit();
      logger.info('Redis disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }
};

// Get Redis client
const getRedisClient = () => {
  if (!redisClient || !redisClient.isOpen) {
    logger.warn('Redis client not connected');
    return null;
  }
  return redisClient;
};

// Redis health check
const healthCheck = async () => {
  try {
    if (!redisClient || !redisClient.isOpen) {
      return { healthy: false, message: 'Redis not connected' };
    }
    
    // Ping Redis
    const response = await redisClient.ping();
    
    return {
      healthy: response === 'PONG',
      message: 'Redis is healthy',
      details: {
        host: config.redis.host,
        port: config.redis.port,
        connected: redisClient.isOpen,
      }
    };
  } catch (error) {
    return {
      healthy: false,
      message: 'Redis health check failed',
      error: error.message
    };
  }
};

// Cache operations wrapper
const cache = {
  // Get value from cache
  get: async (key) => {
    try {
      const client = getRedisClient();
      if (!client) return null;
      
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis GET error:', error);
      return null;
    }
  },
  
  // Set value in cache
  set: async (key, value, ttlSeconds = 3600) => {
    try {
      const client = getRedisClient();
      if (!client) return false;
      
      await client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis SET error:', error);
      return false;
    }
  },
  
  // Delete from cache
  del: async (key) => {
    try {
      const client = getRedisClient();
      if (!client) return false;
      
      await client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis DEL error:', error);
      return false;
    }
  },
  
  // Check if key exists
  exists: async (key) => {
    try {
      const client = getRedisClient();
      if (!client) return false;
      
      const exists = await client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Redis EXISTS error:', error);
      return false;
    }
  },
  
  // Set with expiry
  setWithExpiry: async (key, value, ttlSeconds) => {
    return cache.set(key, value, ttlSeconds);
  },
  
  // Increment counter
  incr: async (key, ttlSeconds = null) => {
    try {
      const client = getRedisClient();
      if (!client) return 0;
      
      const value = await client.incr(key);
      if (ttlSeconds) {
        await client.expire(key, ttlSeconds);
      }
      return value;
    } catch (error) {
      logger.error('Redis INCR error:', error);
      return 0;
    }
  },
  
  // Get TTL
  ttl: async (key) => {
    try {
      const client = getRedisClient();
      if (!client) return -1;
      
      return await client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL error:', error);
      return -1;
    }
  },
  
  // Flush all keys (use with caution)
  flushAll: async () => {
    try {
      const client = getRedisClient();
      if (!client) return false;
      
      if (config.env === 'production') {
        logger.warn('Flush all not allowed in production');
        return false;
      }
      
      await client.flushAll();
      return true;
    } catch (error) {
      logger.error('Redis FLUSHALL error:', error);
      return false;
    }
  },
};

// OTP specific operations
const otpOperations = {
  // Store OTP
  storeOTP: async (phoneNumber, otp) => {
    const key = `otp:${phoneNumber}`;
    const ttl = config.otp.expireMinutes * 60; // Convert to seconds
    return await cache.set(key, { otp, attempts: 0 }, ttl);
  },
  
  // Verify OTP
  verifyOTP: async (phoneNumber, otp) => {
    const key = `otp:${phoneNumber}`;
    const data = await cache.get(key);
    
    if (!data) {
      return { valid: false, reason: 'expired' };
    }
    
    if (data.attempts >= config.otp.maxAttempts) {
      await cache.del(key);
      return { valid: false, reason: 'max_attempts' };
    }
    
    if (data.otp !== otp) {
      data.attempts++;
      await cache.set(key, data, await cache.ttl(key));
      return { valid: false, reason: 'invalid', attemptsLeft: config.otp.maxAttempts - data.attempts };
    }
    
    await cache.del(key);
    return { valid: true };
  },
  
  // Check OTP cooldown
  checkCooldown: async (phoneNumber) => {
    const key = `otp:cooldown:${phoneNumber}`;
    return await cache.exists(key);
  },
  
  // Set OTP cooldown
  setCooldown: async (phoneNumber) => {
    const key = `otp:cooldown:${phoneNumber}`;
    const ttl = config.otp.resendCooldownMinutes * 60;
    return await cache.set(key, true, ttl);
  },
};

// Session operations
const sessionOperations = {
  // Store refresh token
  storeRefreshToken: async (userId, token) => {
    const key = `refresh:${userId}:${token}`;
    const ttl = 7 * 24 * 60 * 60; // 7 days
    return await cache.set(key, { userId, createdAt: Date.now() }, ttl);
  },
  
  // Validate refresh token
  validateRefreshToken: async (userId, token) => {
    const key = `refresh:${userId}:${token}`;
    return await cache.exists(key);
  },
  
  // Revoke refresh token
  revokeRefreshToken: async (userId, token) => {
    const key = `refresh:${userId}:${token}`;
    return await cache.del(key);
  },
  
  // Blacklist access token
  blacklistToken: async (token, expiresIn) => {
    const key = `blacklist:${token}`;
    return await cache.set(key, true, expiresIn);
  },
  
  // Check if token is blacklisted
  isTokenBlacklisted: async (token) => {
    const key = `blacklist:${token}`;
    return await cache.exists(key);
  },
};

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedisClient,
  healthCheck,
  cache,
  otpOperations,
  sessionOperations,
}; 
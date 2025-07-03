// Cache Service
// Handles Redis caching operations

const redisConfig = require('../config/redis');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.defaultTTL = 3600; // 1 hour
    this.keyPrefixes = {
      user: 'user:',
      event: 'event:',
      department: 'dept:',
      attendance: 'att:',
      analytics: 'analytics:',
      session: 'session:',
      otp: 'otp:',
      rate_limit: 'rate:',
      blacklist: 'blacklist:',
      health: 'health:',
      stats: 'stats:'
    };
    this.cacheHitCounter = 0;
    this.cacheMissCounter = 0;
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @param {Object} options - Cache options
   * @returns {Promise<any>} Cached value or null
   */
  async get(key, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      const value = await redisConfig.get(fullKey);
      
      if (value) {
        this.cacheHitCounter++;
        
        // Parse JSON if it's an object
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      } else {
        this.cacheMissCounter++;
        return null;
      }
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {Object} options - Cache options
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      const ttl = options.ttl || this.defaultTTL;
      
      // Serialize objects to JSON
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      
      if (ttl > 0) {
        await redisConfig.setex(fullKey, ttl, serializedValue);
      } else {
        await redisConfig.set(fullKey, serializedValue);
      }
      
      logger.debug(`Cache set: ${fullKey} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get or set cache value with fallback function
   * @param {string} key - Cache key
   * @param {Function} fallbackFn - Function to call if cache miss
   * @param {Object} options - Cache options
   * @returns {Promise<any>} Cached or computed value
   */
  async getOrSet(key, fallbackFn, options = {}) {
    try {
      // Try to get from cache first
      let value = await this.get(key, options);
      
      if (value !== null) {
        return value;
      }
      
      // Cache miss - call fallback function
      logger.debug(`Cache miss for ${key}, calling fallback function`);
      value = await fallbackFn();
      
      // Cache the result if it's not null/undefined
      if (value != null) {
        await this.set(key, value, options);
      }
      
      return value;
    } catch (error) {
      logger.error(`Cache getOrSet error for key ${key}:`, error);
      
      // Try to call fallback function as last resort
      try {
        return await fallbackFn();
      } catch (fallbackError) {
        logger.error(`Fallback function failed for key ${key}:`, fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Delete cache key
   * @param {string} key - Cache key
   * @param {Object} options - Cache options
   * @returns {Promise<boolean>} Success status
   */
  async del(key, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      await redisConfig.del(fullKey);
      logger.debug(`Cache deleted: ${fullKey}`);
      return true;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple cache keys by pattern
   * @param {string} pattern - Key pattern (supports wildcards)
   * @returns {Promise<number>} Number of deleted keys
   */
  async delPattern(pattern) {
    try {
      const keys = await redisConfig.keys(pattern);
      if (keys.length > 0) {
        await redisConfig.del(...keys);
        logger.info(`Cache pattern delete: ${pattern} (${keys.length} keys)`);
        return keys.length;
      }
      return 0;
    } catch (error) {
      logger.error(`Cache pattern delete error for ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @param {Object} options - Cache options
   * @returns {Promise<boolean>} Existence status
   */
  async exists(key, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      const exists = await redisConfig.exists(fullKey);
      return exists === 1;
    } catch (error) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Set TTL for existing key
   * @param {string} key - Cache key
   * @param {number} ttl - TTL in seconds
   * @param {Object} options - Cache options
   * @returns {Promise<boolean>} Success status
   */
  async expire(key, ttl, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      await redisConfig.expire(fullKey, ttl);
      return true;
    } catch (error) {
      logger.error(`Cache expire error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment counter in cache
   * @param {string} key - Cache key
   * @param {number} increment - Increment value (default: 1)
   * @param {Object} options - Cache options
   * @returns {Promise<number>} New counter value
   */
  async incr(key, increment = 1, options = {}) {
    try {
      const fullKey = this.buildKey(key, options.prefix);
      const result = await redisConfig.incrby(fullKey, increment);
      
      // Set TTL if specified
      if (options.ttl) {
        await redisConfig.expire(fullKey, options.ttl);
      }
      
      return result;
    } catch (error) {
      logger.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Cache user data
   * @param {string} userId - User ID
   * @param {Object} userData - User data to cache
   * @param {number} ttl - TTL in seconds (default: 30 minutes)
   * @returns {Promise<boolean>} Success status
   */
  async cacheUser(userId, userData, ttl = 1800) {
    return await this.set(userId, userData, {
      prefix: this.keyPrefixes.user,
      ttl
    });
  }

  /**
   * Get cached user data
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User data or null
   */
  async getUser(userId) {
    return await this.get(userId, {
      prefix: this.keyPrefixes.user
    });
  }

  /**
   * Cache event data
   * @param {string} eventId - Event ID
   * @param {Object} eventData - Event data to cache
   * @param {number} ttl - TTL in seconds (default: 1 hour)
   * @returns {Promise<boolean>} Success status
   */
  async cacheEvent(eventId, eventData, ttl = 3600) {
    return await this.set(eventId, eventData, {
      prefix: this.keyPrefixes.event,
      ttl
    });
  }

  /**
   * Get cached event data
   * @param {string} eventId - Event ID
   * @returns {Promise<Object|null>} Event data or null
   */
  async getEvent(eventId) {
    return await this.get(eventId, {
      prefix: this.keyPrefixes.event
    });
  }

  /**
   * Cache department data
   * @param {string} deptId - Department ID
   * @param {Object} deptData - Department data to cache
   * @param {number} ttl - TTL in seconds (default: 2 hours)
   * @returns {Promise<boolean>} Success status
   */
  async cacheDepartment(deptId, deptData, ttl = 7200) {
    return await this.set(deptId, deptData, {
      prefix: this.keyPrefixes.department,
      ttl
    });
  }

  /**
   * Get cached department data
   * @param {string} deptId - Department ID
   * @returns {Promise<Object|null>} Department data or null
   */
  async getDepartment(deptId) {
    return await this.get(deptId, {
      prefix: this.keyPrefixes.department
    });
  }

  /**
   * Cache analytics data
   * @param {string} analyticsKey - Analytics key
   * @param {Object} analyticsData - Analytics data to cache
   * @param {number} ttl - TTL in seconds (default: 2 hours)
   * @returns {Promise<boolean>} Success status
   */
  async cacheAnalytics(analyticsKey, analyticsData, ttl = 7200) {
    return await this.set(analyticsKey, analyticsData, {
      prefix: this.keyPrefixes.analytics,
      ttl
    });
  }

  /**
   * Get cached analytics data
   * @param {string} analyticsKey - Analytics key
   * @returns {Promise<Object|null>} Analytics data or null
   */
  async getAnalytics(analyticsKey) {
    return await this.get(analyticsKey, {
      prefix: this.keyPrefixes.analytics
    });
  }

  /**
   * Cache session data
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Session data to cache
   * @param {number} ttl - TTL in seconds (default: 24 hours)
   * @returns {Promise<boolean>} Success status
   */
  async cacheSession(sessionId, sessionData, ttl = 86400) {
    return await this.set(sessionId, sessionData, {
      prefix: this.keyPrefixes.session,
      ttl
    });
  }

  /**
   * Get cached session data
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Session data or null
   */
  async getSession(sessionId) {
    return await this.get(sessionId, {
      prefix: this.keyPrefixes.session
    });
  }

  /**
   * Invalidate user-related cache
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of deleted keys
   */
  async invalidateUser(userId) {
    const patterns = [
      `${this.keyPrefixes.user}${userId}*`,
      `${this.keyPrefixes.session}*${userId}*`,
      `${this.keyPrefixes.attendance}*${userId}*`
    ];
    
    let deletedCount = 0;
    for (const pattern of patterns) {
      deletedCount += await this.delPattern(pattern);
    }
    
    logger.info(`Invalidated user cache for ${userId}: ${deletedCount} keys deleted`);
    return deletedCount;
  }

  /**
   * Invalidate event-related cache
   * @param {string} eventId - Event ID
   * @returns {Promise<number>} Number of deleted keys
   */
  async invalidateEvent(eventId) {
    const patterns = [
      `${this.keyPrefixes.event}${eventId}*`,
      `${this.keyPrefixes.attendance}*${eventId}*`,
      `${this.keyPrefixes.analytics}*event*`
    ];
    
    let deletedCount = 0;
    for (const pattern of patterns) {
      deletedCount += await this.delPattern(pattern);
    }
    
    logger.info(`Invalidated event cache for ${eventId}: ${deletedCount} keys deleted`);
    return deletedCount;
  }

  /**
   * Warm cache with frequently accessed data
   * @param {Object} warmingData - Data to warm cache with
   * @returns {Promise<Object>} Warming statistics
   */
  async warmCache(warmingData) {
    const stats = {
      users: 0,
      events: 0,
      departments: 0,
      analytics: 0,
      errors: 0
    };

    try {
      // Warm user cache
      if (warmingData.users) {
        for (const user of warmingData.users) {
          try {
            await this.cacheUser(user._id.toString(), user);
            stats.users++;
          } catch (error) {
            stats.errors++;
            logger.error(`Error warming user cache for ${user._id}:`, error);
          }
        }
      }

      // Warm event cache
      if (warmingData.events) {
        for (const event of warmingData.events) {
          try {
            await this.cacheEvent(event._id.toString(), event);
            stats.events++;
          } catch (error) {
            stats.errors++;
            logger.error(`Error warming event cache for ${event._id}:`, error);
          }
        }
      }

      // Warm department cache
      if (warmingData.departments) {
        for (const dept of warmingData.departments) {
          try {
            await this.cacheDepartment(dept._id.toString(), dept);
            stats.departments++;
          } catch (error) {
            stats.errors++;
            logger.error(`Error warming department cache for ${dept._id}:`, error);
          }
        }
      }

      // Warm analytics cache
      if (warmingData.analytics) {
        for (const [key, data] of Object.entries(warmingData.analytics)) {
          try {
            await this.cacheAnalytics(key, data);
            stats.analytics++;
          } catch (error) {
            stats.errors++;
            logger.error(`Error warming analytics cache for ${key}:`, error);
          }
        }
      }

      logger.info('Cache warming completed:', stats);
      return stats;

    } catch (error) {
      logger.error('Cache warming failed:', error);
      return { ...stats, error: error.message };
    }
  }

  /**
   * Build full cache key with prefix
   * @param {string} key - Base key
   * @param {string} prefix - Key prefix
   * @returns {string} Full cache key
   */
  buildKey(key, prefix = '') {
    return prefix ? `${prefix}${key}` : key;
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getStats() {
    try {
      const info = await redisConfig.info('memory');
      const keyspaceInfo = await redisConfig.info('keyspace');
      
      // Parse memory info
      const memoryLines = info.split('\r\n');
      const memoryUsed = memoryLines.find(line => line.startsWith('used_memory:'));
      const memoryPeak = memoryLines.find(line => line.startsWith('used_memory_peak:'));
      
      // Parse keyspace info
      const keyspaceLines = keyspaceInfo.split('\r\n');
      const db0Info = keyspaceLines.find(line => line.startsWith('db0:'));
      
      let totalKeys = 0;
      if (db0Info) {
        const keysMatch = db0Info.match(/keys=(\d+)/);
        totalKeys = keysMatch ? parseInt(keysMatch[1]) : 0;
      }

      const hitRate = this.cacheHitCounter + this.cacheMissCounter > 0 
        ? (this.cacheHitCounter / (this.cacheHitCounter + this.cacheMissCounter) * 100).toFixed(2)
        : 0;

      return {
        hitRate: `${hitRate}%`,
        hits: this.cacheHitCounter,
        misses: this.cacheMissCounter,
        totalKeys,
        memoryUsed: memoryUsed ? memoryUsed.split(':')[1] : 'unknown',
        memoryPeak: memoryPeak ? memoryPeak.split(':')[1] : 'unknown',
        isConnected: await this.isConnected()
      };

    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return {
        error: error.message,
        isConnected: false
      };
    }
  }

  /**
   * Check if Redis is connected
   * @returns {Promise<boolean>} Connection status
   */
  async isConnected() {
    try {
      await redisConfig.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear all cache
   * @returns {Promise<boolean>} Success status
   */
  async clearAll() {
    try {
      await redisConfig.flushdb();
      logger.warn('All cache cleared');
      return true;
    } catch (error) {
      logger.error('Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Reset cache statistics
   */
  resetStats() {
    this.cacheHitCounter = 0;
    this.cacheMissCounter = 0;
    logger.info('Cache statistics reset');
  }
}

module.exports = new CacheService(); 
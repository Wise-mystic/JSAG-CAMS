const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const User = require('../models/User.model');
const Event = require('../models/Event.model');
const Department = require('../models/Department.model');
const AuditLog = require('../models/AuditLog.model');
const Notification = require('../models/Notification.model');
const redisConfig = require('../config/redis');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { CACHE_KEYS } = require('../utils/constants');

class CleanupJobs {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
  }

  /**
   * Clean up expired tokens and sessions
   * Runs every 4 hours
   */
  async cleanupTokens() {
    try {
      logger.info('Starting token cleanup job');
      
      const cleanupStats = {
        expiredOTPs: 0,
        expiredSessions: 0,
        blacklistedTokens: 0,
        redisKeys: 0
      };

      // Get all Redis keys for cleanup
      const allKeys = await redisConfig.keys('*');
      
      for (const key of allKeys) {
        try {
          const ttl = await redisConfig.ttl(key);
          
          // Remove expired keys (TTL = -2 means expired but not cleaned up)
          if (ttl === -2) {
            await redisConfig.del(key);
            cleanupStats.redisKeys++;
            continue;
          }

          // Count different types of keys
          if (key.startsWith('otp:')) {
            const otpData = await redisConfig.get(key);
            if (!otpData) {
              cleanupStats.expiredOTPs++;
            }
          } else if (key.startsWith('session:')) {
            const sessionData = await redisConfig.get(key);
            if (!sessionData) {
              cleanupStats.expiredSessions++;
            }
          } else if (key.startsWith('blacklist:')) {
            const tokenData = await redisConfig.get(key);
            if (!tokenData) {
              cleanupStats.blacklistedTokens++;
            }
          }
        } catch (keyError) {
          logger.error(`Error processing key ${key}:`, keyError);
        }
      }

      // Clean up users with expired verification status
      const expiredUsers = await User.updateMany(
        {
          isVerified: false,
          createdAt: { 
            $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
          }
        },
        {
          $set: { 
            isActive: false,
            deactivatedAt: new Date(),
            deactivationReason: 'Verification expired'
          }
        }
      );

      cleanupStats.expiredUsers = expiredUsers.modifiedCount;

      logger.info('Token cleanup job completed:', cleanupStats);
      return { success: true, stats: cleanupStats };
      
    } catch (error) {
      logger.error('Token cleanup job failed:', error);
      throw error;
    }
  }

  /**
   * Rotate logs and clean up old log files
   * Runs daily at 2 AM
   */
  async rotateLogs() {
    try {
      logger.info('Starting log rotation job');
      
      const logDir = path.join(__dirname, '../../../logs');
      const maxLogFiles = 30; // Keep 30 days of logs
      const rotationStats = {
        rotatedFiles: 0,
        deletedFiles: 0,
        totalSizeFreed: 0
      };

      // Read log directory
      const logFiles = await fs.readdir(logDir);
      
      const logGroups = {};
      
      // Group log files by type
      for (const file of logFiles) {
        if (file.endsWith('.log')) {
          const baseName = file.replace(/\.\d{4}-\d{2}-\d{2}\.log$/, '').replace('.log', '');
          if (!logGroups[baseName]) {
            logGroups[baseName] = [];
          }
          logGroups[baseName].push(file);
        }
      }

      // Rotate each log group
      for (const [logType, files] of Object.entries(logGroups)) {
        try {
          // Sort files by date (newer first)
          files.sort(async (a, b) => {
            const statsA = await fs.stat(path.join(logDir, a));
            const statsB = await fs.stat(path.join(logDir, b));
            return statsB.mtime - statsA.mtime;
          });

          // Archive current log if it exists and has content
          const currentLogPath = path.join(logDir, `${logType}.log`);
          try {
            const stats = await fs.stat(currentLogPath);
            if (stats.size > 0) {
              const timestamp = new Date().toISOString().split('T')[0];
              const archivedLogPath = path.join(logDir, `${logType}.${timestamp}.log`);
              
              await fs.rename(currentLogPath, archivedLogPath);
              rotationStats.rotatedFiles++;
              
              // Create new empty log file
              await fs.writeFile(currentLogPath, '');
            }
          } catch (statError) {
            // Current log file doesn't exist, skip
          }

          // Delete old log files beyond retention period
          if (files.length > maxLogFiles) {
            const filesToDelete = files.slice(maxLogFiles);
            
            for (const fileToDelete of filesToDelete) {
              try {
                const filePath = path.join(logDir, fileToDelete);
                const stats = await fs.stat(filePath);
                rotationStats.totalSizeFreed += stats.size;
                
                await fs.unlink(filePath);
                rotationStats.deletedFiles++;
                
                logger.info(`Deleted old log file: ${fileToDelete}`);
              } catch (deleteError) {
                logger.error(`Failed to delete log file ${fileToDelete}:`, deleteError);
              }
            }
          }
        } catch (groupError) {
          logger.error(`Error rotating log group ${logType}:`, groupError);
        }
      }

      // Convert bytes to MB for logging
      rotationStats.totalSizeFreedMB = Math.round(rotationStats.totalSizeFreed / 1024 / 1024 * 100) / 100;

      logger.info('Log rotation job completed:', rotationStats);
      return { success: true, stats: rotationStats };
      
    } catch (error) {
      logger.error('Log rotation job failed:', error);
      throw error;
    }
  }

  /**
   * Warm cache with frequently accessed data
   * Runs every 6 hours
   */
  async warmCache() {
    try {
      logger.info('Starting cache warming job');
      
      const warmingStats = {
        departments: 0,
        activeUsers: 0,
        recentEvents: 0,
        systemStats: 0
      };

      // Cache all departments
      const departments = await Department.find({
        isActive: true
      }).select('name code parentDepartment isActive');
      
      await redisConfig.setex(
        'cache:departments', 
        3600, // 1 hour TTL
        JSON.stringify(departments)
      );
      warmingStats.departments = departments.length;

      // Cache active users count by role
      const userStats = await User.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]);
      
      await redisConfig.setex(
        'cache:user_stats', 
        3600,
        JSON.stringify(userStats)
      );
      warmingStats.activeUsers = userStats.reduce((sum, stat) => sum + stat.count, 0);

      // Cache recent events
      const recentEvents = await Event.find({
        createdAt: { 
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }).select('title startTime status type createdBy')
        .populate('createdBy', 'firstName lastName')
        .sort({ startTime: -1 })
        .limit(50);
      
      await redisConfig.setex(
        'cache:recent_events', 
        1800, // 30 minutes TTL
        JSON.stringify(recentEvents)
      );
      warmingStats.recentEvents = recentEvents.length;

      // Cache system statistics
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const systemStats = {
        totalUsers: await User.countDocuments({ isActive: true }),
        totalEvents: await Event.countDocuments(),
        todayEvents: await Event.countDocuments({
          startTime: { $gte: todayStart }
        }),
        totalDepartments: await Department.countDocuments({ isActive: true }),
        lastUpdated: now
      };

      await redisConfig.setex(
        'cache:system_stats', 
        3600,
        JSON.stringify(systemStats)
      );
      warmingStats.systemStats = 1;

      logger.info('Cache warming job completed:', warmingStats);
      return { success: true, stats: warmingStats };
      
    } catch (error) {
      logger.error('Cache warming job failed:', error);
      throw error;
    }
  }

  /**
   * Perform health checks on system components
   * Runs every 15 minutes
   */
  async healthChecks() {
    try {
      logger.info('Starting health checks job');
      
      const healthStatus = {
        database: { status: 'unknown', responseTime: 0 },
        redis: { status: 'unknown', responseTime: 0 },
        diskSpace: { status: 'unknown', usage: 0 },
        memory: { status: 'unknown', usage: 0 },
        timestamp: new Date()
      };

      // Database health check
      const dbStart = Date.now();
      try {
        await mongoose.connection.db.admin().ping();
        healthStatus.database.status = 'healthy';
        healthStatus.database.responseTime = Date.now() - dbStart;
      } catch (dbError) {
        healthStatus.database.status = 'unhealthy';
        healthStatus.database.error = dbError.message;
        logger.error('Database health check failed:', dbError);
      }

      // Redis health check
      const redisStart = Date.now();
      try {
        await redisConfig.ping();
        healthStatus.redis.status = 'healthy';
        healthStatus.redis.responseTime = Date.now() - redisStart;
      } catch (redisError) {
        healthStatus.redis.status = 'unhealthy';
        healthStatus.redis.error = redisError.message;
        logger.error('Redis health check failed:', redisError);
      }

      // Memory usage check
      const memUsage = process.memoryUsage();
      const memUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
      healthStatus.memory.usage = memUsagePercent;
      healthStatus.memory.status = memUsagePercent > 85 ? 'warning' : 'healthy';

      // Store health status in Redis
      await redisConfig.setex(
        'system:health',
        900, // 15 minutes TTL
        JSON.stringify(healthStatus)
      );

      // Log critical issues
      const criticalIssues = [];
      if (healthStatus.database.status === 'unhealthy') {
        criticalIssues.push('Database connection failed');
      }
      if (healthStatus.redis.status === 'unhealthy') {
        criticalIssues.push('Redis connection failed');
      }
      if (healthStatus.memory.usage > 90) {
        criticalIssues.push(`High memory usage: ${healthStatus.memory.usage}%`);
      }

      if (criticalIssues.length > 0) {
        logger.error('Critical health issues detected:', criticalIssues);
      }

      logger.info('Health checks job completed:', {
        database: healthStatus.database.status,
        redis: healthStatus.redis.status,
        memory: `${healthStatus.memory.usage}%`,
        criticalIssues: criticalIssues.length
      });
      
      return { success: true, healthStatus, criticalIssues };
      
    } catch (error) {
      logger.error('Health checks job failed:', error);
      throw error;
    }
  }

  /**
   * Start all cleanup jobs
   */
  startJobs() {
    if (this.isRunning) {
      logger.warn('Cleanup jobs are already running');
      return;
    }

    // Token cleanup every 4 hours
    const tokenCleanupJob = cron.schedule('0 */4 * * *', async () => {
      await this.cleanupTokens();
    }, { scheduled: false });

    // Log rotation daily at 2 AM
    const logRotationJob = cron.schedule('0 2 * * *', async () => {
      await this.rotateLogs();
    }, { scheduled: false });

    // Cache warming every 6 hours
    const cacheWarmingJob = cron.schedule('0 */6 * * *', async () => {
      await this.warmCache();
    }, { scheduled: false });

    // Health checks every 15 minutes
    const healthCheckJob = cron.schedule('*/15 * * * *', async () => {
      await this.healthChecks();
    }, { scheduled: false });

    // Store jobs for management
    this.jobs.set('tokenCleanup', tokenCleanupJob);
    this.jobs.set('logRotation', logRotationJob);
    this.jobs.set('cacheWarming', cacheWarmingJob);
    this.jobs.set('healthCheck', healthCheckJob);

    // Start all jobs
    tokenCleanupJob.start();
    logRotationJob.start();
    cacheWarmingJob.start();
    healthCheckJob.start();

    // Run initial cache warming
    this.warmCache().catch(error => {
      logger.error('Initial cache warming failed:', error);
    });

    this.isRunning = true;
    logger.info('Cleanup jobs started successfully');
  }

  /**
   * Stop all cleanup jobs
   */
  stopJobs() {
    if (!this.isRunning) {
      logger.warn('Cleanup jobs are not running');
      return;
    }

    this.jobs.forEach((job, name) => {
      job.destroy();
      logger.info(`Stopped cleanup job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    logger.info('All cleanup jobs stopped');
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size
    };
  }
}

module.exports = new CleanupJobs(); 
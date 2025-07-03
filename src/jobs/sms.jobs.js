// SMS Jobs
// Handles SMS queue processing, scheduled and bulk SMS, delivery status tracking

const cron = require('node-cron');
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const Event = require('../models/Event.model');
const smsService = require('../services/sms.service');
const redisConfig = require('../config/redis');
const logger = require('../utils/logger');
const { SMS_PRIORITY, SMS_STATUS } = require('../utils/constants');

class SMSJobs {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
    this.processingQueues = {
      immediate: false,
      scheduled: false,
      bulk: false,
      delivery: false
    };
  }

  /**
   * Process immediate SMS queue
   * Runs every minute for high-priority messages
   */
  async processImmediateSMS() {
    if (this.processingQueues.immediate) {
      logger.debug('Immediate SMS processing already in progress');
      return;
    }

    try {
      this.processingQueues.immediate = true;
      logger.info('Starting immediate SMS processing job');
      
      const processStats = {
        processed: 0,
        successful: 0,
        failed: 0,
        retried: 0
      };

      // Get immediate SMS messages from Redis queue
      const immediateMessages = await redisConfig.lrange('sms:immediate', 0, 49); // Process 50 at a time
      
      for (const messageStr of immediateMessages) {
        try {
          const message = JSON.parse(messageStr);
          processStats.processed++;

          const result = await this.processSingleSMS(message);
          
          if (result.success) {
            processStats.successful++;
            // Remove from queue
            await redisConfig.lrem('sms:immediate', 1, messageStr);
          } else {
            // Handle retry logic
            const retryResult = await this.handleSMSRetry(message, 'immediate');
            if (retryResult.shouldRetry) {
              processStats.retried++;
            } else {
              processStats.failed++;
              await redisConfig.lrem('sms:immediate', 1, messageStr);
            }
          }
          
        } catch (messageError) {
          processStats.failed++;
          logger.error('Immediate SMS processing error:', messageError);
          // Remove malformed message from queue
          await redisConfig.lrem('sms:immediate', 1, messageStr);
        }
      }

      logger.info('Immediate SMS processing completed:', processStats);
      return { success: true, stats: processStats };
      
    } catch (error) {
      logger.error('Immediate SMS processing job failed:', error);
      throw error;
    } finally {
      this.processingQueues.immediate = false;
    }
  }

  /**
   * Process scheduled SMS messages
   * Runs every 5 minutes to check for due messages
   */
  async processScheduledSMS() {
    if (this.processingQueues.scheduled) {
      logger.debug('Scheduled SMS processing already in progress');
      return;
    }

    try {
      this.processingQueues.scheduled = true;
      logger.info('Starting scheduled SMS processing job');
      
      const processStats = {
        processed: 0,
        successful: 0,
        failed: 0,
        postponed: 0
      };

      const now = new Date();
      
      // Find scheduled SMS messages that are due
      const dueMessages = await Notification.find({
        type: 'sms',
        status: SMS_STATUS.SCHEDULED,
        scheduledAt: { $lte: now },
        isActive: true
      }).limit(100); // Process 100 at a time

      for (const notification of dueMessages) {
        try {
          processStats.processed++;

          // Check if we should still send this message
          const shouldSend = await this.validateScheduledMessage(notification);
          
          if (!shouldSend.valid) {
            // Cancel the message
            notification.status = SMS_STATUS.CANCELLED;
            notification.failureReason = shouldSend.reason;
            await notification.save();
            continue;
          }

          // Process the SMS
          const smsData = {
            phone: notification.phone,
            message: notification.message,
            priority: notification.priority || SMS_PRIORITY.NORMAL,
            notificationId: notification._id,
            metadata: notification.metadata
          };

          const result = await this.processSingleSMS(smsData);
          
          if (result.success) {
            processStats.successful++;
            notification.status = SMS_STATUS.SENT;
            notification.sentAt = new Date();
            notification.externalId = result.externalId;
          } else {
            // Check if we should retry
            const retryResult = await this.handleNotificationRetry(notification);
            if (retryResult.shouldRetry) {
              processStats.postponed++;
            } else {
              processStats.failed++;
              notification.status = SMS_STATUS.FAILED;
              notification.failureReason = result.error;
            }
          }

          await notification.save();
          
        } catch (messageError) {
          processStats.failed++;
          logger.error(`Scheduled SMS processing error for ${notification._id}:`, messageError);
          
          // Mark as failed
          notification.status = SMS_STATUS.FAILED;
          notification.failureReason = messageError.message;
          await notification.save();
        }
      }

      logger.info('Scheduled SMS processing completed:', processStats);
      return { success: true, stats: processStats };
      
    } catch (error) {
      logger.error('Scheduled SMS processing job failed:', error);
      throw error;
    } finally {
      this.processingQueues.scheduled = false;
    }
  }

  /**
   * Process bulk SMS operations
   * Runs every 10 minutes for batch operations
   */
  async processBulkSMS() {
    if (this.processingQueues.bulk) {
      logger.debug('Bulk SMS processing already in progress');
      return;
    }

    try {
      this.processingQueues.bulk = true;
      logger.info('Starting bulk SMS processing job');
      
      const processStats = {
        campaigns: 0,
        processed: 0,
        successful: 0,
        failed: 0
      };

      // Get bulk SMS campaigns from Redis
      const bulkCampaigns = await redisConfig.lrange('sms:bulk', 0, 4); // Process 5 campaigns at a time
      
      for (const campaignStr of bulkCampaigns) {
        try {
          const campaign = JSON.parse(campaignStr);
          processStats.campaigns++;

          const campaignResult = await this.processBulkCampaign(campaign);
          
          processStats.processed += campaignResult.processed;
          processStats.successful += campaignResult.successful;
          processStats.failed += campaignResult.failed;

          // Remove processed campaign from queue
          await redisConfig.lrem('sms:bulk', 1, campaignStr);
          
        } catch (campaignError) {
          logger.error('Bulk SMS campaign processing error:', campaignError);
          // Remove malformed campaign from queue
          await redisConfig.lrem('sms:bulk', 1, campaignStr);
        }
      }

      logger.info('Bulk SMS processing completed:', processStats);
      return { success: true, stats: processStats };
      
    } catch (error) {
      logger.error('Bulk SMS processing job failed:', error);
      throw error;
    } finally {
      this.processingQueues.bulk = false;
    }
  }

  /**
   * Track delivery status of sent SMS messages
   * Runs every 15 minutes to update delivery statuses
   */
  async trackDeliveryStatus() {
    if (this.processingQueues.delivery) {
      logger.debug('Delivery status tracking already in progress');
      return;
    }

    try {
      this.processingQueues.delivery = true;
      logger.info('Starting delivery status tracking job');
      
      const trackingStats = {
        checked: 0,
        delivered: 0,
        failed: 0,
        pending: 0
      };

      // Find sent SMS messages that need status updates
      const sentMessages = await Notification.find({
        type: 'sms',
        status: SMS_STATUS.SENT,
        externalId: { $exists: true, $ne: null },
        deliveryStatus: { $in: [null, 'pending', 'sent'] },
        sentAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          $lte: new Date(Date.now() - 5 * 60 * 1000) // At least 5 minutes ago
        }
      }).limit(200); // Check 200 at a time

      for (const notification of sentMessages) {
        try {
          trackingStats.checked++;

          // Check delivery status from SMS provider
          const deliveryStatus = await smsService.checkDeliveryStatus(notification.externalId);
          
          if (deliveryStatus.status === 'delivered') {
            notification.deliveryStatus = 'delivered';
            notification.deliveredAt = deliveryStatus.deliveredAt;
            trackingStats.delivered++;
          } else if (deliveryStatus.status === 'failed') {
            notification.deliveryStatus = 'failed';
            notification.failureReason = deliveryStatus.failureReason;
            trackingStats.failed++;
          } else {
            notification.deliveryStatus = 'pending';
            trackingStats.pending++;
          }

          // Update delivery metadata
          notification.deliveryMetadata = {
            ...notification.deliveryMetadata,
            lastChecked: new Date(),
            providerStatus: deliveryStatus.providerStatus,
            statusUpdates: [
              ...(notification.deliveryMetadata?.statusUpdates || []),
              {
                status: deliveryStatus.status,
                timestamp: new Date(),
                details: deliveryStatus.details
              }
            ].slice(-5) // Keep only last 5 status updates
          };

          await notification.save();
          
        } catch (trackingError) {
          logger.error(`Delivery tracking error for ${notification._id}:`, trackingError);
        }
      }

      // Update delivery statistics in Redis
      await this.updateDeliveryStatistics(trackingStats);

      logger.info('Delivery status tracking completed:', trackingStats);
      return { success: true, stats: trackingStats };
      
    } catch (error) {
      logger.error('Delivery status tracking job failed:', error);
      throw error;
    } finally {
      this.processingQueues.delivery = false;
    }
  }

  /**
   * Process a single SMS message
   */
  async processSingleSMS(smsData) {
    try {
      const result = await smsService.sendSMS({
        phone: smsData.phone,
        message: smsData.message,
        priority: smsData.priority
      });

      // Update notification record if provided
      if (smsData.notificationId) {
        await Notification.findByIdAndUpdate(smsData.notificationId, {
          externalId: result.messageId,
          sentAt: new Date(),
          deliveryMetadata: {
            provider: result.provider,
            cost: result.cost,
            segments: result.segments
          }
        });
      }

      return {
        success: true,
        externalId: result.messageId,
        cost: result.cost
      };
      
    } catch (error) {
      logger.error('SMS sending failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process bulk SMS campaign
   */
  async processBulkCampaign(campaign) {
    const stats = {
      processed: 0,
      successful: 0,
      failed: 0
    };

    try {
      const { recipients, message, campaignId, metadata } = campaign;
      
      // Process recipients in batches of 10
      const batchSize = 10;
      const batches = [];
      
      for (let i = 0; i < recipients.length; i += batchSize) {
        batches.push(recipients.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const batchPromises = batch.map(async (recipient) => {
          try {
            stats.processed++;

            // Create notification record
            const notification = new Notification({
              type: 'sms',
              phone: recipient.phone,
              message: this.personalizeMessage(message, recipient),
              status: SMS_STATUS.PENDING,
              priority: SMS_PRIORITY.BULK,
              metadata: {
                campaignId,
                recipientId: recipient.id,
                ...metadata
              }
            });

            await notification.save();

            // Send SMS
            const result = await this.processSingleSMS({
              phone: recipient.phone,
              message: notification.message,
              priority: SMS_PRIORITY.BULK,
              notificationId: notification._id
            });

            if (result.success) {
              stats.successful++;
              notification.status = SMS_STATUS.SENT;
            } else {
              stats.failed++;
              notification.status = SMS_STATUS.FAILED;
              notification.failureReason = result.error;
            }

            await notification.save();
            
          } catch (error) {
            stats.failed++;
            logger.error(`Bulk SMS error for ${recipient.phone}:`, error);
          }
        });

        // Wait for batch to complete before processing next batch
        await Promise.all(batchPromises);
        
        // Add delay between batches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Update campaign status in database
      if (campaignId) {
        await this.updateCampaignStatus(campaignId, stats);
      }

    } catch (error) {
      logger.error('Bulk campaign processing failed:', error);
    }

    return stats;
  }

  /**
   * Handle SMS retry logic
   */
  async handleSMSRetry(message, queueType) {
    const maxRetries = 3;
    const retryCount = message.retryCount || 0;

    if (retryCount >= maxRetries) {
      return { shouldRetry: false, reason: 'Max retries exceeded' };
    }

    // Increment retry count
    message.retryCount = retryCount + 1;
    message.lastRetryAt = new Date();

    // Calculate retry delay (exponential backoff)
    const retryDelay = Math.pow(2, retryCount) * 60 * 1000; // 1min, 2min, 4min
    message.nextRetryAt = new Date(Date.now() + retryDelay);

    // Add back to queue with delay
    const queueKey = `sms:${queueType}:retry`;
    await redisConfig.lpush(queueKey, JSON.stringify(message));
    await redisConfig.expire(queueKey, Math.ceil(retryDelay / 1000));

    return { shouldRetry: true, nextRetryAt: message.nextRetryAt };
  }

  /**
   * Validate scheduled message before sending
   */
  async validateScheduledMessage(notification) {
    // Check if event still exists for event-related messages
    if (notification.metadata?.eventId) {
      const event = await Event.findById(notification.metadata.eventId);
      if (!event || event.status === 'cancelled') {
        return { valid: false, reason: 'Associated event cancelled or deleted' };
      }
    }

    // Check if user still exists and is active
    if (notification.metadata?.userId) {
      const user = await User.findById(notification.metadata.userId);
      if (!user || !user.isActive) {
        return { valid: false, reason: 'Recipient user inactive or deleted' };
      }
    }

    // Check for duplicates in recent history
    const recentDuplicate = await Notification.findOne({
      phone: notification.phone,
      message: notification.message,
      sentAt: {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      },
      status: { $in: [SMS_STATUS.SENT, SMS_STATUS.DELIVERED] }
    });

    if (recentDuplicate) {
      return { valid: false, reason: 'Duplicate message sent recently' };
    }

    return { valid: true };
  }

  /**
   * Personalize message with recipient data
   */
  personalizeMessage(template, recipient) {
    let personalizedMessage = template;
    
    // Replace common placeholders
    personalizedMessage = personalizedMessage.replace('{{firstName}}', recipient.firstName || '');
    personalizedMessage = personalizedMessage.replace('{{lastName}}', recipient.lastName || '');
    personalizedMessage = personalizedMessage.replace('{{fullName}}', 
      `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim());
    
    // Replace custom placeholders from metadata
    if (recipient.metadata) {
      Object.keys(recipient.metadata).forEach(key => {
        personalizedMessage = personalizedMessage.replace(`{{${key}}}`, recipient.metadata[key]);
      });
    }

    return personalizedMessage;
  }

  /**
   * Update delivery statistics
   */
  async updateDeliveryStatistics(stats) {
    const today = new Date().toISOString().split('T')[0];
    const statsKey = `sms:stats:${today}`;
    
    // Update daily statistics
    await redisConfig.hincrby(statsKey, 'checked', stats.checked);
    await redisConfig.hincrby(statsKey, 'delivered', stats.delivered);
    await redisConfig.hincrby(statsKey, 'failed', stats.failed);
    await redisConfig.hincrby(statsKey, 'pending', stats.pending);
    
    // Set expiry for 30 days
    await redisConfig.expire(statsKey, 30 * 24 * 60 * 60);
  }

  /**
   * Start all SMS jobs
   */
  startJobs() {
    if (this.isRunning) {
      logger.warn('SMS jobs are already running');
      return;
    }

    // Immediate SMS processing every minute
    const immediateJob = cron.schedule('* * * * *', async () => {
      await this.processImmediateSMS();
    }, { scheduled: false });

    // Scheduled SMS processing every 5 minutes
    const scheduledJob = cron.schedule('*/5 * * * *', async () => {
      await this.processScheduledSMS();
    }, { scheduled: false });

    // Bulk SMS processing every 10 minutes
    const bulkJob = cron.schedule('*/10 * * * *', async () => {
      await this.processBulkSMS();
    }, { scheduled: false });

    // Delivery status tracking every 15 minutes
    const deliveryJob = cron.schedule('*/15 * * * *', async () => {
      await this.trackDeliveryStatus();
    }, { scheduled: false });

    // Store jobs for management
    this.jobs.set('immediate', immediateJob);
    this.jobs.set('scheduled', scheduledJob);
    this.jobs.set('bulk', bulkJob);
    this.jobs.set('delivery', deliveryJob);

    // Start all jobs
    immediateJob.start();
    scheduledJob.start();
    bulkJob.start();
    deliveryJob.start();

    this.isRunning = true;
    logger.info('SMS jobs started successfully');
  }

  /**
   * Stop all SMS jobs
   */
  stopJobs() {
    if (!this.isRunning) {
      logger.warn('SMS jobs are not running');
      return;
    }

    this.jobs.forEach((job, name) => {
      job.destroy();
      logger.info(`Stopped SMS job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    logger.info('All SMS jobs stopped');
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size,
      processingQueues: { ...this.processingQueues }
    };
  }

  /**
   * Get SMS statistics
   */
  async getStatistics(days = 7) {
    const stats = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const statsKey = `sms:stats:${dateStr}`;
      
      const dayStats = await redisConfig.hgetall(statsKey);
      stats[dateStr] = {
        checked: parseInt(dayStats.checked || 0),
        delivered: parseInt(dayStats.delivered || 0),
        failed: parseInt(dayStats.failed || 0),
        pending: parseInt(dayStats.pending || 0)
      };
    }
    
    return stats;
  }
}

module.exports = new SMSJobs(); 
// SMS Service
// Handles SMS sending, scheduling, templates, and delivery status

const axios = require('axios');
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const redisConfig = require('../config/redis');
const smsConfig = require('../config/sms');
const logger = require('../utils/logger');
const { SMS_PRIORITY, SMS_STATUS, SMS_TEMPLATES } = require('../utils/constants');

class SMSService {
  constructor() {
    this.provider = 'SMSnotifyGh';
    this.baseURL = smsConfig.baseURL;
    this.apiKey = smsConfig.apiKey;
    this.senderId = smsConfig.senderId;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.rateLimits = {
      immediate: 100, // per minute
      bulk: 500, // per hour
      daily: 10000 // per day
    };
  }

  /**
   * Send single SMS message
   * @param {Object} options - SMS options
   * @param {string} options.phone - Recipient phone number
   * @param {string} options.message - SMS message content
   * @param {string} options.priority - Message priority
   * @param {Object} options.metadata - Additional metadata
   * @returns {Promise<Object>} Send result
   */
  async sendSMS(options) {
    try {
      const { phone, message, priority = SMS_PRIORITY.NORMAL, metadata = {} } = options;

      // Validate inputs
      const validation = this.validateSMSData(phone, message);
      if (!validation.valid) {
        throw new Error(`SMS validation failed: ${validation.error}`);
      }

      // Check rate limits
      await this.checkRateLimits(priority);

      // Create notification record
      const notification = new Notification({
        type: 'sms',
        phone: this.formatPhoneNumber(phone),
        message: message.trim(),
        status: SMS_STATUS.PENDING,
        priority,
        metadata,
        provider: this.provider,
        cost: this.calculateSMSCost(message)
      });

      await notification.save();

      // Route SMS based on priority
      let result;
      if (priority === SMS_PRIORITY.IMMEDIATE) {
        result = await this.sendImmediateSMS(notification);
      } else {
        result = await this.queueSMS(notification);
      }

      return {
        success: true,
        messageId: result.messageId,
        notificationId: notification._id,
        cost: notification.cost,
        segments: this.calculateSegments(message),
        provider: this.provider
      };

    } catch (error) {
      logger.error('SMS sending failed:', error);
      throw error;
    }
  }

  /**
   * Send immediate SMS (bypasses queue)
   */
  async sendImmediateSMS(notification) {
    try {
      if (!this.isProduction) {
        // Mock response for development
        const mockResult = {
          messageId: `mock_${Date.now()}`,
          status: 'sent',
          cost: notification.cost
        };

        notification.status = SMS_STATUS.SENT;
        notification.externalId = mockResult.messageId;
        notification.sentAt = new Date();
        await notification.save();

        logger.info(`[DEV] Mock SMS sent to ${notification.phone}: ${notification.message}`);
        return mockResult;
      }

      // Send via SMSnotifyGh API
      const response = await axios.post(`${this.baseURL}/send`, {
        recipient: notification.phone,
        sender: this.senderId,
        message: notification.message,
        type: 0, // Plain text
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.data.status === 'success') {
        notification.status = SMS_STATUS.SENT;
        notification.externalId = response.data.message_id;
        notification.sentAt = new Date();
        notification.deliveryMetadata = {
          provider: this.provider,
          providerResponse: response.data,
          apiVersion: '1.0'
        };

        await notification.save();

        // Update rate limiting counters
        await this.updateRateLimitCounters('immediate');

        logger.info(`SMS sent successfully to ${notification.phone} (ID: ${response.data.message_id})`);

        return {
          messageId: response.data.message_id,
          status: 'sent',
          cost: notification.cost
        };
      } else {
        throw new Error(`SMS API error: ${response.data.message || 'Unknown error'}`);
      }

    } catch (error) {
      notification.status = SMS_STATUS.FAILED;
      notification.failureReason = error.message;
      notification.failedAt = new Date();
      await notification.save();

      logger.error(`SMS failed for ${notification.phone}:`, error);
      throw error;
    }
  }

  /**
   * Queue SMS for background processing
   */
  async queueSMS(notification) {
    try {
      const queueData = {
        notificationId: notification._id.toString(),
        phone: notification.phone,
        message: notification.message,
        priority: notification.priority,
        metadata: notification.metadata,
        queuedAt: new Date()
      };

      // Add to appropriate queue based on priority
      const queueName = this.getQueueName(notification.priority);
      await redisConfig.lpush(queueName, JSON.stringify(queueData));

      // Set TTL for queue item (24 hours)
      await redisConfig.expire(queueName, 86400);

      notification.status = SMS_STATUS.QUEUED;
      notification.queuedAt = new Date();
      await notification.save();

      logger.info(`SMS queued for ${notification.phone} in ${queueName} queue`);

      return {
        messageId: notification._id.toString(),
        status: 'queued',
        queueName
      };

    } catch (error) {
      logger.error('SMS queueing failed:', error);
      throw error;
    }
  }

  /**
   * Send bulk SMS messages
   */
  async sendBulkSMS(options) {
    try {
      const { recipients, message, campaignId, metadata = {} } = options;

      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('Recipients array is required and cannot be empty');
      }

      const bulkOperation = {
        campaignId: campaignId || `bulk_${Date.now()}`,
        totalRecipients: recipients.length,
        message,
        metadata,
        recipients: recipients.map(recipient => ({
          phone: this.formatPhoneNumber(recipient.phone),
          personalData: recipient.personalData || {},
          id: recipient.id || recipient.phone
        })),
        createdAt: new Date()
      };

      // Add to bulk SMS queue
      await redisConfig.lpush('sms:bulk', JSON.stringify(bulkOperation));

      logger.info(`Bulk SMS campaign queued: ${bulkOperation.campaignId} (${recipients.length} recipients)`);

      return {
        success: true,
        campaignId: bulkOperation.campaignId,
        totalRecipients: recipients.length,
        estimatedCost: this.calculateBulkSMSCost(message, recipients.length),
        estimatedSegments: this.calculateSegments(message) * recipients.length
      };

    } catch (error) {
      logger.error('Bulk SMS operation failed:', error);
      throw error;
    }
  }

  /**
   * Schedule SMS for later delivery
   */
  async scheduleSMS(options) {
    try {
      const { phone, message, scheduledAt, metadata = {} } = options;

      if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
        throw new Error('Scheduled time must be in the future');
      }

      const notification = new Notification({
        type: 'sms',
        phone: this.formatPhoneNumber(phone),
        message: message.trim(),
        status: SMS_STATUS.SCHEDULED,
        scheduledAt: new Date(scheduledAt),
        metadata,
        provider: this.provider,
        cost: this.calculateSMSCost(message)
      });

      await notification.save();

      logger.info(`SMS scheduled for ${phone} at ${scheduledAt}`);

      return {
        success: true,
        notificationId: notification._id,
        scheduledAt: notification.scheduledAt,
        cost: notification.cost
      };

    } catch (error) {
      logger.error('SMS scheduling failed:', error);
      throw error;
    }
  }

  /**
   * Check delivery status of SMS
   */
  async checkDeliveryStatus(externalId) {
    try {
      if (!this.isProduction) {
        // Mock delivery status for development
        const statuses = ['delivered', 'pending', 'failed'];
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
        
        return {
          status: randomStatus,
          deliveredAt: randomStatus === 'delivered' ? new Date() : null,
          failureReason: randomStatus === 'failed' ? 'Mock failure' : null,
          providerStatus: randomStatus,
          details: `Mock status check for ${externalId}`
        };
      }

      const response = await axios.get(`${this.baseURL}/status/${externalId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 15000
      });

      const statusMapping = {
        'delivered': 'delivered',
        'sent': 'pending',
        'failed': 'failed',
        'expired': 'failed'
      };

      const providerStatus = response.data.status;
      const mappedStatus = statusMapping[providerStatus] || 'pending';

      return {
        status: mappedStatus,
        deliveredAt: mappedStatus === 'delivered' ? new Date(response.data.delivered_at) : null,
        failureReason: mappedStatus === 'failed' ? response.data.failure_reason : null,
        providerStatus,
        details: response.data.details || 'Status check completed'
      };

    } catch (error) {
      logger.error(`Delivery status check failed for ${externalId}:`, error);
      return {
        status: 'unknown',
        deliveredAt: null,
        failureReason: 'Status check failed',
        providerStatus: 'unknown',
        details: error.message
      };
    }
  }

  /**
   * Send SMS using template
   */
  async sendTemplatedSMS(templateName, phone, data = {}) {
    try {
      const template = this.getTemplate(templateName);
      if (!template) {
        throw new Error(`SMS template not found: ${templateName}`);
      }

      const message = this.renderTemplate(template, data);
      
      return await this.sendSMS({
        phone,
        message,
        priority: template.priority || SMS_PRIORITY.NORMAL,
        metadata: {
          template: templateName,
          templateData: data
        }
      });

    } catch (error) {
      logger.error(`Templated SMS failed for template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Get SMS templates
   */
  getTemplate(templateName) {
    const templates = {
      [SMS_TEMPLATES.OTP_VERIFICATION]: {
        message: 'Your CAMS verification code is: {{otp}}. Valid for 5 minutes. Do not share this code.',
        priority: SMS_PRIORITY.IMMEDIATE
      },
      [SMS_TEMPLATES.WELCOME]: {
        message: 'Welcome to {{churchName}}! Your account has been created. Login with your phone number to get started.',
        priority: SMS_PRIORITY.NORMAL
      },
      [SMS_TEMPLATES.EVENT_REMINDER]: {
        message: 'Reminder: {{eventTitle}} starts at {{startTime}}. See you there! - {{churchName}}',
        priority: SMS_PRIORITY.NORMAL
      },
      [SMS_TEMPLATES.EVENT_CANCELLED]: {
        message: 'NOTICE: {{eventTitle}} scheduled for {{startTime}} has been cancelled. Contact church office for details.',
        priority: SMS_PRIORITY.IMMEDIATE
      },
      [SMS_TEMPLATES.ATTENDANCE_MARKED]: {
        message: 'Your attendance for {{eventTitle}} has been recorded. Thank you for participating!',
        priority: SMS_PRIORITY.LOW
      },
      [SMS_TEMPLATES.PASSWORD_RESET]: {
        message: 'Your CAMS password reset code is: {{resetCode}}. Valid for 15 minutes. Do not share this code.',
        priority: SMS_PRIORITY.IMMEDIATE
      },
      [SMS_TEMPLATES.BULK_ANNOUNCEMENT]: {
        message: '{{message}} - {{churchName}}',
        priority: SMS_PRIORITY.BULK
      }
    };

    return templates[templateName];
  }

  /**
   * Render template with data
   */
  renderTemplate(template, data) {
    let message = template.message;
    
    // Replace all placeholders
    Object.keys(data).forEach(key => {
      const placeholder = `{{${key}}}`;
      message = message.replace(new RegExp(placeholder, 'g'), data[key] || '');
    });

    // Clean up any remaining placeholders
    message = message.replace(/\{\{.*?\}\}/g, '');
    
    return message.trim();
  }

  /**
   * Validate SMS data
   */
  validateSMSData(phone, message) {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, error: 'Phone number is required' };
    }

    if (!message || typeof message !== 'string') {
      return { valid: false, error: 'Message is required' };
    }

    if (message.trim().length === 0) {
      return { valid: false, error: 'Message cannot be empty' };
    }

    if (message.length > 1600) {
      return { valid: false, error: 'Message too long (max 1600 characters)' };
    }

    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone.replace(/[\s-()]/g, ''))) {
      return { valid: false, error: 'Invalid phone number format' };
    }

    return { valid: true };
  }

  /**
   * Format phone number for Ghana (+233)
   */
  formatPhoneNumber(phone) {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle Ghana numbers
    if (cleaned.startsWith('0')) {
      cleaned = '233' + cleaned.substring(1);
    } else if (cleaned.startsWith('233')) {
      // Already formatted
    } else if (cleaned.length === 9) {
      cleaned = '233' + cleaned;
    }
    
    return '+' + cleaned;
  }

  /**
   * Calculate SMS cost (in Ghana Pesewas)
   */
  calculateSMSCost(message) {
    const segments = this.calculateSegments(message);
    const costPerSegment = 0.05; // 5 pesewas per segment
    return segments * costPerSegment;
  }

  /**
   * Calculate bulk SMS cost
   */
  calculateBulkSMSCost(message, recipientCount) {
    const costPerSMS = this.calculateSMSCost(message);
    const bulkDiscount = recipientCount > 100 ? 0.8 : recipientCount > 50 ? 0.9 : 1;
    return costPerSMS * recipientCount * bulkDiscount;
  }

  /**
   * Calculate SMS segments
   */
  calculateSegments(message) {
    const length = message.length;
    if (length <= 160) return 1;
    if (length <= 306) return 2;
    return Math.ceil(length / 153);
  }

  /**
   * Check rate limits
   */
  async checkRateLimits(priority) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thisHour = `${today}:${now.getHours()}`;
    const thisMinute = `${thisHour}:${now.getMinutes()}`;

    // Check daily limit
    const dailyKey = `sms:rate:daily:${today}`;
    const dailyCount = await redisConfig.incr(dailyKey);
    await redisConfig.expire(dailyKey, 86400);

    if (dailyCount > this.rateLimits.daily) {
      throw new Error('Daily SMS limit exceeded');
    }

    // Check minute limit for immediate SMS
    if (priority === SMS_PRIORITY.IMMEDIATE) {
      const minuteKey = `sms:rate:minute:${thisMinute}`;
      const minuteCount = await redisConfig.incr(minuteKey);
      await redisConfig.expire(minuteKey, 60);

      if (minuteCount > this.rateLimits.immediate) {
        throw new Error('Immediate SMS rate limit exceeded');
      }
    }

    // Check hourly limit for bulk SMS
    if (priority === SMS_PRIORITY.BULK) {
      const hourKey = `sms:rate:hour:${thisHour}`;
      const hourCount = await redisConfig.incr(hourKey);
      await redisConfig.expire(hourKey, 3600);

      if (hourCount > this.rateLimits.bulk) {
        throw new Error('Bulk SMS rate limit exceeded');
      }
    }
  }

  /**
   * Update rate limiting counters
   */
  async updateRateLimitCounters(type) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const statsKey = `sms:stats:${today}`;

    await redisConfig.hincrby(statsKey, `sent_${type}`, 1);
    await redisConfig.hincrby(statsKey, 'total_sent', 1);
    await redisConfig.expire(statsKey, 86400 * 30); // Keep for 30 days
  }

  /**
   * Get queue name based on priority
   */
  getQueueName(priority) {
    const queueMap = {
      [SMS_PRIORITY.IMMEDIATE]: 'sms:immediate',
      [SMS_PRIORITY.HIGH]: 'sms:high',
      [SMS_PRIORITY.NORMAL]: 'sms:normal',
      [SMS_PRIORITY.LOW]: 'sms:low',
      [SMS_PRIORITY.BULK]: 'sms:bulk'
    };

    return queueMap[priority] || 'sms:normal';
  }

  /**
   * Get SMS statistics
   */
  async getStatistics(days = 30) {
    const stats = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const statsKey = `sms:stats:${dateStr}`;
      
      const dayStats = await redisConfig.hgetall(statsKey);
      stats[dateStr] = {
        total_sent: parseInt(dayStats.total_sent || 0),
        sent_immediate: parseInt(dayStats.sent_immediate || 0),
        sent_normal: parseInt(dayStats.sent_normal || 0),
        sent_bulk: parseInt(dayStats.sent_bulk || 0)
      };
    }
    
    return stats;
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      const queueSizes = {};
      const queues = ['sms:immediate', 'sms:high', 'sms:normal', 'sms:low', 'sms:bulk'];
      
      for (const queue of queues) {
        queueSizes[queue] = await redisConfig.llen(queue);
      }

      const pendingNotifications = await Notification.countDocuments({
        type: 'sms',
        status: { $in: [SMS_STATUS.PENDING, SMS_STATUS.QUEUED] }
      });

      return {
        status: 'healthy',
        provider: this.provider,
        isProduction: this.isProduction,
        queueSizes,
        pendingNotifications,
        lastChecked: new Date()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date()
      };
    }
  }
}

module.exports = new SMSService(); 
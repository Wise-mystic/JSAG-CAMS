// Email Service
// Handles backup email notifications

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs').promises;
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const Event = require('../models/Event.model');
const redisConfig = require('../config/redis');
const environment = require('../config/environment');
const logger = require('../utils/logger');
const { EMAIL_TEMPLATES, EMAIL_STATUS, EMAIL_PRIORITY } = require('../utils/constants');

class EmailService {
  constructor() {
    this.transporter = null;
    this.emailConfig = {
      host: environment.EMAIL_HOST || 'smtp.gmail.com',
      port: environment.EMAIL_PORT || 587,
      secure: environment.EMAIL_SECURE === 'true' || false,
      auth: {
        user: environment.EMAIL_USER,
        pass: environment.EMAIL_PASS
      }
    };
    this.fromEmail = environment.EMAIL_FROM || 'noreply@cams.church';
    this.fromName = environment.EMAIL_FROM_NAME || 'CAMS - Church Attendance Management';
    this.isProduction = process.env.NODE_ENV === 'production';
    this.templatesDir = path.join(__dirname, '../templates/email');
    this.rateLimits = {
      daily: 500, // 500 emails per day
      hourly: 50,  // 50 emails per hour
      burst: 10    // 10 emails per minute
    };
    
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter
   */
  async initializeTransporter() {
    try {
      if (!this.emailConfig.auth.user || !this.emailConfig.auth.pass) {
        logger.warn('Email credentials not configured. Email service will run in mock mode.');
        return;
      }

      this.transporter = nodemailer.createTransporter(this.emailConfig);
      
      // Verify transporter configuration
      if (this.isProduction) {
        await this.transporter.verify();
        logger.info('Email service initialized successfully');
      }
    } catch (error) {
      logger.error('Email service initialization failed:', error);
      this.transporter = null;
    }
  }

  /**
   * Send email
   * @param {Object} options - Email options
   * @returns {Promise<Object>} Send result
   */
  async sendEmail(options) {
    try {
      const {
        to,
        subject,
        html,
        text,
        priority = EMAIL_PRIORITY.NORMAL,
        metadata = {},
        template,
        templateData
      } = options;

      // Validate email address
      if (!this.isValidEmail(to)) {
        throw new Error(`Invalid email address: ${to}`);
      }

      // Check rate limits
      await this.checkRateLimits(priority);

      // Generate content from template if provided
      let emailHtml = html;
      let emailText = text;
      
      if (template) {
        const templateContent = await this.renderTemplate(template, templateData || {});
        emailHtml = templateContent.html;
        emailText = templateContent.text;
      }

      // Create notification record
      const notification = new Notification({
        type: 'email',
        email: to,
        subject,
        message: emailText || this.stripHtml(emailHtml),
        status: EMAIL_STATUS.PENDING,
        priority,
        metadata: {
          ...metadata,
          template: template || null,
          templateData: templateData || null
        },
        provider: 'nodemailer'
      });

      await notification.save();

      // Send email based on priority
      let result;
      if (priority === EMAIL_PRIORITY.IMMEDIATE) {
        result = await this.sendImmediateEmail(notification, {
          to,
          subject,
          html: emailHtml,
          text: emailText
        });
      } else {
        result = await this.queueEmail(notification, {
          to,
          subject,
          html: emailHtml,
          text: emailText
        });
      }

      return {
        success: true,
        messageId: result.messageId,
        notificationId: notification._id,
        status: result.status
      };

    } catch (error) {
      logger.error('Email sending failed:', error);
      throw error;
    }
  }

  /**
   * Send immediate email (bypasses queue)
   */
  async sendImmediateEmail(notification, emailData) {
    try {
      if (!this.transporter) {
        // Mock email for development/testing
        const mockResult = {
          messageId: `mock_email_${Date.now()}`,
          status: 'sent'
        };

        notification.status = EMAIL_STATUS.SENT;
        notification.externalId = mockResult.messageId;
        notification.sentAt = new Date();
        await notification.save();

        logger.info(`[DEV] Mock email sent to ${emailData.to}: ${emailData.subject}`);
        return mockResult;
      }

      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        headers: {
          'X-Priority': this.getPriorityHeader(notification.priority),
          'X-Notification-ID': notification._id.toString()
        }
      };

      const result = await this.transporter.sendMail(mailOptions);

      // Update notification
      notification.status = EMAIL_STATUS.SENT;
      notification.externalId = result.messageId;
      notification.sentAt = new Date();
      notification.deliveryMetadata = {
        provider: 'nodemailer',
        providerResponse: {
          messageId: result.messageId,
          response: result.response
        }
      };

      await notification.save();

      // Update rate limiting counters
      await this.updateRateLimitCounters('immediate');

      logger.info(`Email sent successfully to ${emailData.to} (ID: ${result.messageId})`);

      return {
        messageId: result.messageId,
        status: 'sent'
      };

    } catch (error) {
      notification.status = EMAIL_STATUS.FAILED;
      notification.failureReason = error.message;
      notification.failedAt = new Date();
      await notification.save();

      logger.error(`Email failed for ${emailData.to}:`, error);
      throw error;
    }
  }

  /**
   * Queue email for background processing
   */
  async queueEmail(notification, emailData) {
    try {
      const queueData = {
        notificationId: notification._id.toString(),
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        priority: notification.priority,
        metadata: notification.metadata,
        queuedAt: new Date()
      };

      // Add to appropriate queue based on priority
      const queueName = this.getQueueName(notification.priority);
      await redisConfig.lpush(queueName, JSON.stringify(queueData));

      // Set TTL for queue item (24 hours)
      await redisConfig.expire(queueName, 86400);

      notification.status = EMAIL_STATUS.QUEUED;
      notification.queuedAt = new Date();
      await notification.save();

      logger.info(`Email queued for ${emailData.to} in ${queueName} queue`);

      return {
        messageId: notification._id.toString(),
        status: 'queued',
        queueName
      };

    } catch (error) {
      logger.error('Email queueing failed:', error);
      throw error;
    }
  }

  /**
   * Send email using template
   */
  async sendTemplatedEmail(templateName, to, data = {}) {
    try {
      const template = this.getTemplateConfig(templateName);
      if (!template) {
        throw new Error(`Email template not found: ${templateName}`);
      }

      return await this.sendEmail({
        to,
        template: templateName,
        templateData: data,
        priority: template.priority || EMAIL_PRIORITY.NORMAL,
        metadata: {
          template: templateName,
          templateData: data
        }
      });

    } catch (error) {
      logger.error(`Templated email failed for template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Send backup email when SMS fails
   */
  async sendBackupEmail(smsNotificationId, userEmail) {
    try {
      const smsNotification = await Notification.findById(smsNotificationId);
      if (!smsNotification) {
        throw new Error('SMS notification not found');
      }

      const subject = 'Important Message from Church';
      const template = EMAIL_TEMPLATES.BACKUP_NOTIFICATION;
      
      const templateData = {
        message: smsNotification.message,
        originalType: 'SMS',
        churchName: process.env.CHURCH_NAME || 'Church',
        timestamp: new Date().toLocaleString()
      };

      return await this.sendTemplatedEmail(template, userEmail, templateData);

    } catch (error) {
      logger.error('Backup email failed:', error);
      throw error;
    }
  }

  /**
   * Send bulk emails
   */
  async sendBulkEmails(options) {
    try {
      const { recipients, subject, template, templateData, campaignId, metadata = {} } = options;

      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('Recipients array is required and cannot be empty');
      }

      const bulkOperation = {
        campaignId: campaignId || `email_bulk_${Date.now()}`,
        totalRecipients: recipients.length,
        subject,
        template,
        templateData,
        metadata,
        recipients: recipients.map(recipient => ({
          email: recipient.email,
          personalData: recipient.personalData || {},
          id: recipient.id || recipient.email
        })),
        createdAt: new Date()
      };

      // Add to bulk email queue
      await redisConfig.lpush('email:bulk', JSON.stringify(bulkOperation));

      logger.info(`Bulk email campaign queued: ${bulkOperation.campaignId} (${recipients.length} recipients)`);

      return {
        success: true,
        campaignId: bulkOperation.campaignId,
        totalRecipients: recipients.length
      };

    } catch (error) {
      logger.error('Bulk email operation failed:', error);
      throw error;
    }
  }

  /**
   * Schedule email for later delivery
   */
  async scheduleEmail(options) {
    try {
      const { to, subject, html, text, scheduledAt, template, templateData, metadata = {} } = options;

      if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
        throw new Error('Scheduled time must be in the future');
      }

      // Generate content if template provided
      let emailHtml = html;
      let emailText = text;
      
      if (template) {
        const templateContent = await this.renderTemplate(template, templateData || {});
        emailHtml = templateContent.html;
        emailText = templateContent.text;
      }

      const notification = new Notification({
        type: 'email',
        email: to,
        subject,
        message: emailText || this.stripHtml(emailHtml),
        status: EMAIL_STATUS.SCHEDULED,
        scheduledAt: new Date(scheduledAt),
        metadata: {
          ...metadata,
          template: template || null,
          templateData: templateData || null,
          html: emailHtml
        },
        provider: 'nodemailer'
      });

      await notification.save();

      logger.info(`Email scheduled for ${to} at ${scheduledAt}`);

      return {
        success: true,
        notificationId: notification._id,
        scheduledAt: notification.scheduledAt
      };

    } catch (error) {
      logger.error('Email scheduling failed:', error);
      throw error;
    }
  }

  /**
   * Render email template
   */
  async renderTemplate(templateName, data) {
    try {
      const template = this.getTemplateConfig(templateName);
      if (!template) {
        throw new Error(`Email template not found: ${templateName}`);
      }

      // For now, use simple text-based templates
      // In production, you might want to use a proper template engine like Handlebars
      
      let html = template.html || `
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2c3e50;">${template.subject}</h2>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                ${template.message}
              </div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">
                This email was sent from ${process.env.CHURCH_NAME || 'Church'} Attendance Management System.
              </p>
            </div>
          </body>
        </html>
      `;

      let text = template.text || template.message;

      // Replace placeholders
      Object.keys(data).forEach(key => {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        html = html.replace(placeholder, data[key] || '');
        text = text.replace(placeholder, data[key] || '');
      });

      // Clean up any remaining placeholders
      html = html.replace(/\{\{.*?\}\}/g, '');
      text = text.replace(/\{\{.*?\}\}/g, '');

      return { html, text, subject: template.subject };

    } catch (error) {
      logger.error('Template rendering failed:', error);
      throw error;
    }
  }

  /**
   * Get email template configuration
   */
  getTemplateConfig(templateName) {
    const templates = {
      [EMAIL_TEMPLATES.BACKUP_NOTIFICATION]: {
        subject: 'Important Message from {{churchName}}',
        message: 'We tried to reach you via SMS but were unable to deliver the message. Here is the important information: {{message}}',
        priority: EMAIL_PRIORITY.HIGH
      },
      [EMAIL_TEMPLATES.WELCOME]: {
        subject: 'Welcome to {{churchName}}',
        message: 'Welcome to {{churchName}}! Your account has been created successfully. You can now access the church management system.',
        priority: EMAIL_PRIORITY.NORMAL
      },
      [EMAIL_TEMPLATES.PASSWORD_RESET]: {
        subject: 'Password Reset Request',
        message: 'You have requested a password reset. Use this code to reset your password: {{resetCode}}. This code expires in 15 minutes.',
        priority: EMAIL_PRIORITY.HIGH
      },
      [EMAIL_TEMPLATES.EVENT_REMINDER]: {
        subject: 'Event Reminder: {{eventTitle}}',
        message: 'This is a reminder that {{eventTitle}} is scheduled for {{startTime}}. We look forward to seeing you there!',
        priority: EMAIL_PRIORITY.NORMAL
      },
      [EMAIL_TEMPLATES.EVENT_CANCELLED]: {
        subject: 'Event Cancelled: {{eventTitle}}',
        message: 'We regret to inform you that {{eventTitle}} scheduled for {{startTime}} has been cancelled. Please contact the church office for more information.',
        priority: EMAIL_PRIORITY.HIGH
      },
      [EMAIL_TEMPLATES.MONTHLY_REPORT]: {
        subject: 'Monthly Church Report - {{month}} {{year}}',
        message: 'Please find attached your monthly church activity report for {{month}} {{year}}.',
        priority: EMAIL_PRIORITY.LOW
      }
    };

    return templates[templateName];
  }

  /**
   * Validate email address
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Strip HTML tags from content
   */
  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Get priority header value
   */
  getPriorityHeader(priority) {
    const priorityMap = {
      [EMAIL_PRIORITY.HIGH]: '1',
      [EMAIL_PRIORITY.NORMAL]: '3',
      [EMAIL_PRIORITY.LOW]: '5'
    };
    return priorityMap[priority] || '3';
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
    const dailyKey = `email:rate:daily:${today}`;
    const dailyCount = await redisConfig.incr(dailyKey);
    await redisConfig.expire(dailyKey, 86400);

    if (dailyCount > this.rateLimits.daily) {
      throw new Error('Daily email limit exceeded');
    }

    // Check hourly limit
    const hourKey = `email:rate:hour:${thisHour}`;
    const hourCount = await redisConfig.incr(hourKey);
    await redisConfig.expire(hourKey, 3600);

    if (hourCount > this.rateLimits.hourly) {
      throw new Error('Hourly email limit exceeded');
    }

    // Check burst limit for immediate emails
    if (priority === EMAIL_PRIORITY.IMMEDIATE) {
      const burstKey = `email:rate:minute:${thisMinute}`;
      const burstCount = await redisConfig.incr(burstKey);
      await redisConfig.expire(burstKey, 60);

      if (burstCount > this.rateLimits.burst) {
        throw new Error('Email burst limit exceeded');
      }
    }
  }

  /**
   * Update rate limiting counters
   */
  async updateRateLimitCounters(type) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const statsKey = `email:stats:${today}`;

    await redisConfig.hincrby(statsKey, `sent_${type}`, 1);
    await redisConfig.hincrby(statsKey, 'total_sent', 1);
    await redisConfig.expire(statsKey, 86400 * 30); // Keep for 30 days
  }

  /**
   * Get queue name based on priority
   */
  getQueueName(priority) {
    const queueMap = {
      [EMAIL_PRIORITY.HIGH]: 'email:high',
      [EMAIL_PRIORITY.NORMAL]: 'email:normal',
      [EMAIL_PRIORITY.LOW]: 'email:low'
    };

    return queueMap[priority] || 'email:normal';
  }

  /**
   * Get email statistics
   */
  async getStatistics(days = 7) {
    const stats = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const statsKey = `email:stats:${dateStr}`;
      
      const dayStats = await redisConfig.hgetall(statsKey);
      stats[dateStr] = {
        total_sent: parseInt(dayStats.total_sent || 0),
        sent_immediate: parseInt(dayStats.sent_immediate || 0),
        sent_normal: parseInt(dayStats.sent_normal || 0),
        sent_low: parseInt(dayStats.sent_low || 0)
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
      const queues = ['email:high', 'email:normal', 'email:low', 'email:bulk'];
      
      for (const queue of queues) {
        queueSizes[queue] = await redisConfig.llen(queue);
      }

      const pendingNotifications = await Notification.countDocuments({
        type: 'email',
        status: { $in: [EMAIL_STATUS.PENDING, EMAIL_STATUS.QUEUED] }
      });

      // Test transporter if available
      let transporterStatus = 'not_configured';
      if (this.transporter) {
        try {
          if (this.isProduction) {
            await this.transporter.verify();
          }
          transporterStatus = 'healthy';
        } catch (error) {
          transporterStatus = 'unhealthy';
        }
      }

      return {
        status: transporterStatus === 'healthy' ? 'healthy' : 'degraded',
        transporter: transporterStatus,
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

module.exports = new EmailService(); 
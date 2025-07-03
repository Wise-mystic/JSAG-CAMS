const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const Event = require('../models/Event.model');
const AuditLog = require('../models/AuditLog.model');
const smsService = require('../config/sms');
const { ApiError } = require('../middleware/error.middleware');
const { 
  USER_ROLES, 
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
  ROLE_HIERARCHY,
  ERROR_CODES, 
  AUDIT_ACTIONS,
  SUCCESS_MESSAGES 
} = require('../utils/constants');
const mongoose = require('mongoose');
const cron = require('node-cron');

class NotificationService {
  constructor() {
    // Delay setup to ensure all constants are loaded
    process.nextTick(() => {
      try {
        this.setupNotificationSchedules();
      } catch (error) {
        console.error('Error setting up notification schedules:', error);
        logger.error('Failed to setup notification schedules', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Send SMS notification to a single recipient
   */
  async sendSMSNotification(notificationData, sentBy, sentByRole, ipAddress) {
    const {
      recipient, // phone number or user ID
      message,
      type = NOTIFICATION_TYPES.GENERAL,
      eventId,
      priority = 'normal',
      scheduledFor,
      template,
      templateData = {}
    } = notificationData;

    // Validate sender permissions
    if (!this.canSendNotifications(sentByRole)) {
      throw ApiError.forbidden(
        'Insufficient permissions to send notifications',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Resolve recipient
    const recipientData = await this.resolveRecipient(recipient);
    if (!recipientData) {
      throw ApiError.badRequest('Invalid recipient', ERROR_CODES.INVALID_INPUT);
    }

    // Prepare message content
    let messageContent = message;
    if (template) {
      messageContent = await this.processTemplate(template, templateData);
    }

    // Validate message content
    if (!messageContent || messageContent.trim().length === 0) {
      throw ApiError.badRequest('Message content is required', ERROR_CODES.INVALID_INPUT);
    }

    if (messageContent.length > 1600) { // SMS limit
      throw ApiError.badRequest('Message exceeds SMS character limit', ERROR_CODES.INVALID_INPUT);
    }

    // Create notification record
    const notification = new Notification({
      recipient: {
        userId: recipientData.userId,
        phoneNumber: recipientData.phoneNumber,
        name: recipientData.name
      },
      message: messageContent,
      type,
      eventId,
      priority,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      sentBy,
      status: scheduledFor ? NOTIFICATION_STATUS.SCHEDULED : NOTIFICATION_STATUS.PENDING,
      metadata: {
        template,
        templateData,
        ipAddress
      }
    });

    await notification.save();

    // Send immediately if not scheduled
    if (!scheduledFor) {
      await this.processSMSNotification(notification._id);
    }

    // Log notification creation
    await AuditLog.logAction({
      userId: sentBy,
      action: AUDIT_ACTIONS.NOTIFICATION_SEND,
      resource: 'notification',
      resourceId: notification._id,
      details: {
        recipient: recipientData.phoneNumber,
        type,
        eventId,
        scheduled: !!scheduledFor,
        messageLength: messageContent.length
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getNotificationById(notification._id);
  }

  /**
   * Send bulk SMS notifications
   */
  async sendBulkSMSNotifications(bulkData, sentBy, sentByRole, ipAddress) {
    const {
      recipients, // array of phone numbers or user IDs
      message,
      type = NOTIFICATION_TYPES.BULK,
      eventId,
      priority = 'normal',
      scheduledFor,
      template,
      templateData = {},
      filterCriteria // optional filtering criteria
    } = bulkData;

    // Validate sender permissions
    if (!this.canSendBulkNotifications(sentByRole)) {
      throw ApiError.forbidden(
        'Insufficient permissions to send bulk notifications',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Resolve recipients
    let recipientsList = [];
    
    if (recipients && recipients.length > 0) {
      // Use provided recipients
      for (const recipient of recipients) {
        const recipientData = await this.resolveRecipient(recipient);
        if (recipientData) {
          recipientsList.push(recipientData);
        }
      }
    } else if (filterCriteria) {
      // Use filter criteria to find recipients
      recipientsList = await this.findRecipientsByFilter(filterCriteria);
    } else {
      throw ApiError.badRequest('Recipients or filter criteria required', ERROR_CODES.INVALID_INPUT);
    }

    if (recipientsList.length === 0) {
      throw ApiError.badRequest('No valid recipients found', ERROR_CODES.INVALID_INPUT);
    }

    // Prepare message content
    let messageContent = message;
    if (template) {
      messageContent = await this.processTemplate(template, templateData);
    }

    // Validate message content
    if (!messageContent || messageContent.trim().length === 0) {
      throw ApiError.badRequest('Message content is required', ERROR_CODES.INVALID_INPUT);
    }

    const results = {
      successful: [],
      failed: [],
      totalRecipients: recipientsList.length
    };

    // Create notification records for each recipient
    for (const recipientData of recipientsList) {
      try {
        const notification = new Notification({
          recipient: {
            userId: recipientData.userId,
            phoneNumber: recipientData.phoneNumber,
            name: recipientData.name
          },
          message: messageContent,
          type,
          eventId,
          priority,
          scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
          sentBy,
          status: scheduledFor ? NOTIFICATION_STATUS.SCHEDULED : NOTIFICATION_STATUS.PENDING,
          metadata: {
            template,
            templateData,
            bulkOperationId: new mongoose.Types.ObjectId(), // Group bulk notifications
            ipAddress
          }
        });

        await notification.save();

        // Send immediately if not scheduled
        if (!scheduledFor) {
          await this.processSMSNotification(notification._id);
        }

        results.successful.push({
          notificationId: notification._id,
          recipient: recipientData.phoneNumber,
          name: recipientData.name
        });

      } catch (error) {
        results.failed.push({
          recipient: recipientData.phoneNumber,
          name: recipientData.name,
          error: error.message
        });
      }
    }

    // Log bulk notification operation
    await AuditLog.logAction({
      userId: sentBy,
      action: AUDIT_ACTIONS.NOTIFICATION_BULK_SEND,
      resource: 'notification',
      resourceId: eventId || null,
      details: {
        totalRecipients: recipientsList.length,
        successful: results.successful.length,
        failed: results.failed.length,
        type,
        scheduled: !!scheduledFor,
        messageLength: messageContent.length
      },
      ipAddress,
      result: { success: true }
    });

    return results;
  }

  /**
   * Send event reminder notifications
   */
  async sendEventReminders(eventId, reminderType = 'default', sentBy, sentByRole, ipAddress) {
    const event = await Event.findById(eventId)
      .populate('departmentId', 'name')
      .populate('ministryId', 'name')
      .populate('prayerTribeId', 'name');

    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canSendEventReminders(sentBy, sentByRole, event)) {
      throw ApiError.forbidden(
        'Insufficient permissions to send event reminders',
        ERROR_CODES.ACCESS_DENIED
      );
    }

    // Get event participants or target audience
    const recipients = await this.getEventRecipients(event);

    if (recipients.length === 0) {
      throw ApiError.badRequest('No recipients found for this event', ERROR_CODES.NO_RECIPIENTS);
    }

    // Prepare reminder message
    const reminderMessage = await this.generateEventReminderMessage(event, reminderType);

    // Send bulk notifications
    const results = await this.sendBulkSMSNotifications({
      recipients: recipients.map(r => r.userId),
      message: reminderMessage,
      type: NOTIFICATION_TYPES.EVENT_REMINDER,
      eventId,
      priority: 'high',
      template: 'event_reminder',
      templateData: {
        eventTitle: event.title,
        eventDate: event.startTime,
        eventLocation: event.location?.name || 'TBA',
        reminderType
      }
    }, sentBy, sentByRole, ipAddress);

    return {
      eventId,
      eventTitle: event.title,
      reminderType,
      ...results
    };
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(notificationId) {
    const notification = await Notification.findById(notificationId)
      .populate('sentBy', 'fullName role')
      .populate('eventId', 'title startTime');

    if (!notification) {
      throw ApiError.notFound('Notification not found', ERROR_CODES.NOTIFICATION_NOT_FOUND);
    }

    return notification;
  }

  /**
   * Get notifications with filtering
   */
  async getNotifications(filters = {}, options = {}) {
    const {
      page = 1,
      limit = 50,
      sort = '-createdAt',
      status,
      type,
      eventId,
      sentBy,
      recipient,
      startDate,
      endDate,
      includeDeliveryStatus = false
    } = options;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (eventId) query.eventId = eventId;
    if (sentBy) query.sentBy = sentBy;
    if (recipient) {
      query.$or = [
        { 'recipient.phoneNumber': { $regex: recipient, $options: 'i' } },
        { 'recipient.name': { $regex: recipient, $options: 'i' } }
      ];
    }

    // Date range filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Apply role-based access control
    if (filters.scopedAccess) {
      const scopedQuery = this.applyScopedAccess(filters.currentUserId, filters.currentUserRole);
      Object.assign(query, scopedQuery);
    }

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('sentBy', 'fullName role')
        .populate('eventId', 'title startTime')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(query)
    ]);

    // Include delivery status if requested
    if (includeDeliveryStatus) {
      for (const notification of notifications) {
        if (notification.deliveryStatus?.trackingId) {
          try {
            const status = await smsService.getDeliveryStatus(notification.deliveryStatus.trackingId);
            notification.deliveryStatus.currentStatus = status;
          } catch (error) {
            // Silently fail if delivery status check fails
          }
        }
      }
    }

    return {
      notifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotifications: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get notification dashboard
   */
  async getNotificationDashboard(userId, userRole, options = {}) {
    const { timeframe = 30 } = options;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Apply scoped access
    const scopedQuery = this.applyScopedAccess(userId, userRole);

    // Get notification statistics
    const stats = await this.getNotificationStats(scopedQuery, startDate);

    // Get recent notifications
    const recentNotifications = await Notification.find({
      ...scopedQuery,
      createdAt: { $gte: startDate }
    })
    .populate('sentBy', 'fullName role')
    .populate('eventId', 'title startTime')
    .sort('-createdAt')
    .limit(20);

    // Get delivery statistics
    const deliveryStats = await this.getDeliveryStats(scopedQuery, startDate);

    return {
      period: { days: timeframe, startDate },
      statistics: stats,
      deliveryStatistics: deliveryStats,
      recentNotifications
    };
  }

  /**
   * Process scheduled notifications
   */
  async processScheduledNotifications() {
    // Safety check for NOTIFICATION_STATUS
    if (!NOTIFICATION_STATUS || !NOTIFICATION_STATUS.SCHEDULED) {
      logger.error('NOTIFICATION_STATUS.SCHEDULED is undefined');
      return 0;
    }
    
    const now = new Date();
    
    const scheduledNotifications = await Notification.find({
      status: NOTIFICATION_STATUS.SCHEDULED,
      scheduledFor: { $lte: now }
    }).limit(100); // Process in batches

    for (const notification of scheduledNotifications) {
      try {
        await this.processSMSNotification(notification._id);
      } catch (error) {
        console.error(`Failed to process scheduled notification ${notification._id}:`, error);
        
        // Update notification status to failed
        await Notification.findByIdAndUpdate(notification._id, {
          status: NOTIFICATION_STATUS.FAILED,
          deliveryStatus: {
            error: error.message,
            failedAt: new Date()
          }
        });
      }
    }

    return scheduledNotifications.length;
  }

  /**
   * Retry failed notifications
   */
  async retryFailedNotifications(maxRetries = 3) {
    // Safety check for NOTIFICATION_STATUS
    if (!NOTIFICATION_STATUS || !NOTIFICATION_STATUS.FAILED) {
      logger.error('NOTIFICATION_STATUS.FAILED is undefined');
      return { retried: 0, successful: 0, stillFailed: 0 };
    }
    
    const failedNotifications = await Notification.find({
      status: NOTIFICATION_STATUS.FAILED,
      'deliveryStatus.retryCount': { $lt: maxRetries }
    }).limit(50);

    const results = {
      retried: 0,
      successful: 0,
      stillFailed: 0
    };

    for (const notification of failedNotifications) {
      try {
        results.retried++;
        await this.processSMSNotification(notification._id, true);
        results.successful++;
      } catch (error) {
        results.stillFailed++;
        
        // Update retry count
        await Notification.findByIdAndUpdate(notification._id, {
          $inc: { 'deliveryStatus.retryCount': 1 },
          'deliveryStatus.lastRetryAt': new Date(),
          'deliveryStatus.lastError': error.message
        });
      }
    }

    return results;
  }

  // Helper methods
  async resolveRecipient(recipient) {
    if (typeof recipient === 'string') {
      // Could be phone number or user ID
      if (mongoose.Types.ObjectId.isValid(recipient)) {
        // User ID
        const user = await User.findById(recipient);
        return user ? {
          userId: user._id,
          phoneNumber: user.phoneNumber,
          name: user.fullName
        } : null;
      } else {
        // Phone number - try to find user
        const user = await User.findOne({ phoneNumber: recipient });
        return {
          userId: user?._id || null,
          phoneNumber: recipient,
          name: user?.fullName || 'Unknown'
        };
      }
    }
    
    return null;
  }

  async findRecipientsByFilter(filterCriteria) {
    const {
      role,
      departmentId,
      ministryId,
      prayerTribeId,
      isActive = true
    } = filterCriteria;

    const query = { isActive };

    if (role) query.role = role;
    if (departmentId) query.departmentId = departmentId;
    if (ministryId) query.ministryId = ministryId;
    if (prayerTribeId) query.prayerTribes = prayerTribeId;

    const users = await User.find(query).select('_id phoneNumber fullName');
    
    return users.map(user => ({
      userId: user._id,
      phoneNumber: user.phoneNumber,
      name: user.fullName
    }));
  }

  async processTemplate(template, templateData) {
    // Simple template processing - in production, you might use a more sophisticated template engine
    const templates = {
      event_reminder: `Hi {name}! Reminder: "{eventTitle}" is coming up on {eventDate} at {eventLocation}. See you there!`,
      event_update: `Hi {name}! Important update for "{eventTitle}": {updateMessage}`,
      attendance_reminder: `Hi {name}! Don't forget to mark your attendance for "{eventTitle}". Thank you!`,
      welcome: `Welcome to our church, {name}! We're excited to have you join us. God bless!`,
      general: `{message}`
    };

    let messageTemplate = templates[template] || templates.general;

    // Replace placeholders
    for (const [key, value] of Object.entries(templateData)) {
      const placeholder = `{${key}}`;
      messageTemplate = messageTemplate.replace(new RegExp(placeholder, 'g'), value);
    }

    return messageTemplate;
  }

  async processSMSNotification(notificationId, isRetry = false) {
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      throw new Error('Notification not found');
    }

    // Update status to sending
    notification.status = NOTIFICATION_STATUS.SENDING;
    notification.deliveryStatus = notification.deliveryStatus || {};
    notification.deliveryStatus.sentAt = new Date();
    
    if (isRetry) {
      notification.deliveryStatus.retryCount = (notification.deliveryStatus.retryCount || 0) + 1;
    }

    await notification.save();

    try {
      // Send SMS using SMS service
      const response = await smsService.sendSMS(
        notification.recipient.phoneNumber,
        notification.message
      );

      // Update notification with success status
      notification.status = NOTIFICATION_STATUS.SENT;
      notification.deliveryStatus.trackingId = response.messageId;
      notification.deliveryStatus.provider = 'SMSNotifyGh';
      notification.deliveryStatus.cost = response.cost || 0;
      notification.deliveryStatus.deliveredAt = new Date();

      await notification.save();

      return notification;

    } catch (error) {
      // Update notification with failure status
      notification.status = NOTIFICATION_STATUS.FAILED;
      notification.deliveryStatus.error = error.message;
      notification.deliveryStatus.failedAt = new Date();

      await notification.save();

      throw error;
    }
  }

  async getEventRecipients(event) {
    // Get recipients based on event target audience
    const recipients = [];

    if (event.targetAudience === 'all') {
      // All active users
      const users = await User.find({ isActive: true }).select('_id phoneNumber fullName');
      recipients.push(...users);
    } else if (event.targetAudience === 'department' && event.departmentId) {
      // Department members
      const users = await User.find({ 
        departmentId: event.departmentId,
        isActive: true 
      }).select('_id phoneNumber fullName');
      recipients.push(...users);
    } else if (event.targetAudience === 'ministry' && event.ministryId) {
      // Ministry members
      const users = await User.find({ 
        ministryId: event.ministryId,
        isActive: true 
      }).select('_id phoneNumber fullName');
      recipients.push(...users);
    } else if (event.targetAudience === 'prayer_tribe' && event.prayerTribeId) {
      // Prayer tribe members
      const users = await User.find({ 
        prayerTribes: event.prayerTribeId,
        isActive: true 
      }).select('_id phoneNumber fullName');
      recipients.push(...users);
    } else if (event.participants && event.participants.length > 0) {
      // Event participants
      const userIds = event.participants.map(p => p.userId);
      const users = await User.find({ 
        _id: { $in: userIds },
        isActive: true 
      }).select('_id phoneNumber fullName');
      recipients.push(...users);
    }

    return recipients;
  }

  async generateEventReminderMessage(event, reminderType) {
    const eventDate = new Date(event.startTime).toLocaleDateString();
    const eventTime = new Date(event.startTime).toLocaleTimeString();
    
    const messages = {
      default: `Reminder: "${event.title}" is scheduled for ${eventDate} at ${eventTime}. Location: ${event.location?.name || 'TBA'}. See you there!`,
      urgent: `URGENT REMINDER: "${event.title}" starts soon on ${eventDate} at ${eventTime}. Don't miss it!`,
      followup: `Follow-up: "${event.title}" is coming up on ${eventDate}. We hope to see you there!`
    };

    return messages[reminderType] || messages.default;
  }

  setupNotificationSchedules() {
    // Only setup schedules if we're not in test mode
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Process scheduled notifications every minute
    cron.schedule('* * * * *', async () => {
      try {
        // Check if NOTIFICATION_STATUS is defined
        if (!NOTIFICATION_STATUS || !NOTIFICATION_STATUS.SCHEDULED) {
          console.warn('NOTIFICATION_STATUS not properly defined, skipping scheduled notifications processing');
          return;
        }
        await this.processScheduledNotifications();
      } catch (error) {
        console.error('Error processing scheduled notifications:', error);
        logger.error('Failed to process scheduled notifications', { error: error.message, stack: error.stack });
      }
    });

    // Retry failed notifications every hour
    cron.schedule('0 * * * *', async () => {
      try {
        // Check if NOTIFICATION_STATUS is defined
        if (!NOTIFICATION_STATUS || !NOTIFICATION_STATUS.FAILED) {
          console.warn('NOTIFICATION_STATUS not properly defined, skipping failed notifications retry');
          return;
        }
        await this.retryFailedNotifications();
      } catch (error) {
        console.error('Error retrying failed notifications:', error);
        logger.error('Failed to retry failed notifications', { error: error.message, stack: error.stack });
      }
    });

    // Cleanup old notifications daily
    cron.schedule('0 2 * * *', async () => {
      try {
        await this.cleanupOldNotifications();
      } catch (error) {
        console.error('Error cleaning up old notifications:', error);
        logger.error('Failed to cleanup old notifications', { error: error.message, stack: error.stack });
      }
    });
  }

  async cleanupOldNotifications() {
    // Archive notifications older than 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await Notification.updateMany(
      { 
        createdAt: { $lt: cutoffDate },
        isArchived: { $ne: true }
      },
      { 
        isArchived: true,
        archivedAt: new Date()
      }
    );

    return result.modifiedCount;
  }

  async getNotificationStats(scopedQuery, startDate) {
    const stats = await Notification.aggregate([
      {
        $match: {
          ...scopedQuery,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);

    return {
      total,
      sent: stats.find(s => s._id === NOTIFICATION_STATUS.SENT)?.count || 0,
      pending: stats.find(s => s._id === NOTIFICATION_STATUS.PENDING)?.count || 0,
      failed: stats.find(s => s._id === NOTIFICATION_STATUS.FAILED)?.count || 0,
      scheduled: stats.find(s => s._id === NOTIFICATION_STATUS.SCHEDULED)?.count || 0
    };
  }

  async getDeliveryStats(scopedQuery, startDate) {
    const deliveryStats = await Notification.aggregate([
      {
        $match: {
          ...scopedQuery,
          createdAt: { $gte: startDate },
          status: NOTIFICATION_STATUS.SENT
        }
      },
      {
        $group: {
          _id: null,
          totalSent: { $sum: 1 },
          totalCost: { $sum: '$deliveryStatus.cost' },
          avgDeliveryTime: {
            $avg: {
              $subtract: ['$deliveryStatus.deliveredAt', '$deliveryStatus.sentAt']
            }
          }
        }
      }
    ]);

    return deliveryStats[0] || {
      totalSent: 0,
      totalCost: 0,
      avgDeliveryTime: 0
    };
  }

  // Permission checking methods
  canSendNotifications(userRole) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.DEPARTMENT_LEADER];
  }

  canSendBulkNotifications(userRole) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.PASTOR];
  }

  canSendEventReminders(userId, userRole, event) {
    // High-level roles can send reminders for any event
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Event creator can send reminders
    if (event.createdBy?.toString() === userId.toString()) {
      return true;
    }

    // Assigned clocker can send reminders
    if (event.assignedClockerId?.toString() === userId.toString()) {
      return true;
    }

    return false;
  }

  applyScopedAccess(userId, userRole) {
    const query = {};

    // High-level roles can see all notifications
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return query;
    }

    // Department leaders can see notifications they sent
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      query.sentBy = new mongoose.Types.ObjectId(userId);
      return query;
    }

    // Clockers can see notifications they sent
    if (userRole === USER_ROLES.CLOCKER) {
      query.sentBy = new mongoose.Types.ObjectId(userId);
      return query;
    }

    // Members can't see any notifications (admin feature)
    query._id = { $exists: false }; // Return no results
    return query;
  }
}

module.exports = new NotificationService(); 
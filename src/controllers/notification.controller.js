// Notification Controller
// Handles SMS sending, scheduling, templates, delivery status, and bulk send

const NotificationService = require('../services/notification.service');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');

class NotificationController {
  // POST /api/v1/notifications/send
  async send(req, res, next) {
    try {
      const {
        recipients,
        type,
        subject,
        message,
        templateId,
        variables,
        priority,
        scheduleFor
      } = req.body;

      // Basic validation
      if (!recipients || !recipients.length) {
        return next(ApiError.badRequest('Recipients are required'));
      }

      if (!message && !templateId) {
        return next(ApiError.badRequest('Message or template ID is required'));
      }

      const notification = await NotificationService.sendNotification(
        {
          recipients,
          type,
          subject,
          message,
          templateId,
          variables,
          priority,
          scheduleFor
        },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Notification sent successfully', {
        notificationId: notification._id,
        recipientCount: recipients.length,
        sentBy: req.user.id,
        type,
        scheduled: !!scheduleFor,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: scheduleFor ? 'Notification scheduled successfully' : 'Notification sent successfully',
        data: { notification }
      });
    } catch (error) {
      logger.error('Send notification failed', {
        error: error.message,
        sentBy: req.user.id,
        recipientCount: req.body.recipients?.length,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/schedule
  async schedule(req, res, next) {
    try {
      const {
        recipients,
        type,
        subject,
        message,
        scheduleFor,
        templateId,
        variables,
        recurrence
      } = req.body;

      // Basic validation
      if (!recipients || !recipients.length) {
        return next(ApiError.badRequest('Recipients are required'));
      }

      if (!message && !templateId) {
        return next(ApiError.badRequest('Message or template ID is required'));
      }

      if (!scheduleFor) {
        return next(ApiError.badRequest('Schedule date is required'));
      }

      const notification = await NotificationService.scheduleNotification(
        {
          recipients,
          type,
          subject,
          message,
          scheduleFor,
          templateId,
          variables,
          recurrence
        },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Notification scheduled successfully', {
        notificationId: notification._id,
        recipientCount: recipients.length,
        sentBy: req.user.id,
        type,
        scheduledFor: scheduleFor,
        isRecurring: !!recurrence,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'Notification scheduled successfully',
        data: { notification }
      });
    } catch (error) {
      logger.error('Schedule notification failed', {
        error: error.message,
        sentBy: req.user.id,
        recipientCount: req.body.recipients?.length,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/templates
  async getTemplates(req, res, next) {
    try {
      const { page, limit, sortBy, sortOrder, category, type, search } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        sortBy: sortBy || 'createdAt',
        sortOrder: sortOrder || 'desc',
        category,
        type,
        search
      };

      const templates = await NotificationService.getTemplates(options);

      res.status(200).json({
        success: true,
        data: templates.data,
        pagination: templates.pagination
      });
    } catch (error) {
      logger.error('Get templates failed', {
        error: error.message,
        requestedBy: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/templates
  async createTemplate(req, res, next) {
    try {
      const {
        name,
        description,
        type,
        subject,
        content,
        variables,
        category,
        isActive
      } = req.body;

      const template = await NotificationService.createTemplate(
        {
          name,
          description,
          type,
          subject,
          content,
          variables,
          category,
          isActive
        },
        req.user.id
      );

      logger.info('Notification template created', {
        templateId: template._id,
        name,
        type,
        category,
        createdBy: req.user.id
      });

      res.status(201).json({
        success: true,
        message: 'Template created successfully',
        data: { template }
      });
    } catch (error) {
      logger.error('Create template failed', {
        error: error.message,
        createdBy: req.user.id,
        templateName: req.body.name
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/bulk-send
  async bulkSend(req, res, next) {
    try {
      const {
        targetGroups,
        type,
        subject,
        message,
        templateId,
        variables,
        priority,
        scheduleFor
      } = req.body;

      // Basic validation
      if (!targetGroups || Object.keys(targetGroups).length === 0) {
        return next(ApiError.badRequest('Target groups are required'));
      }

      if (!message && !templateId) {
        return next(ApiError.badRequest('Message or template ID is required'));
      }

      const result = await NotificationService.sendBulkNotifications(
        {
          targetGroups,
          type,
          subject,
          message,
          templateId,
          variables,
          priority,
          scheduleFor
        },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Bulk notifications sent successfully', {
        batchId: result.batchId,
        recipientCount: result.totalRecipients,
        sentBy: req.user.id,
        type,
        scheduled: !!scheduleFor,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: scheduleFor ? 'Bulk notifications scheduled successfully' : 'Bulk notifications sent successfully',
        data: result
      });
    } catch (error) {
      logger.error('Bulk send failed', {
        error: error.message,
        sentBy: req.user.id,
        targetGroups: Object.keys(req.body.targetGroups || {}),
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/history
  async getNotificationHistory(req, res, next) {
    try {
      const {
        page,
        limit,
        startDate,
        endDate,
        type,
        status,
        search
      } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        type,
        status,
        search
      };

      const history = await NotificationService.getNotificationHistory(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: history.data,
        pagination: history.pagination
      });
    } catch (error) {
      logger.error('Get notification history failed', {
        error: error.message,
        requestedBy: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/stats
  async getNotificationStats(req, res, next) {
    try {
      const { startDate, endDate, type } = req.query;

      const options = {
        startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: endDate ? new Date(endDate) : new Date(),
        type
      };

      const stats = await NotificationService.getNotificationStatistics(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Get notification stats failed', {
        error: error.message,
        requestedBy: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // PUT /api/v1/notifications/templates/:id
  async updateTemplate(req, res, next) {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        content,
        variables,
        isActive
      } = req.body;

      const template = await NotificationService.updateTemplate(
        id,
        {
          name,
          description,
          content,
          variables,
          isActive
        },
        req.user.id,
        req.user.role
      );

      logger.info('Notification template updated', {
        templateId: id,
        updatedBy: req.user.id,
        fields: Object.keys(req.body)
      });

      res.status(200).json({
        success: true,
        message: 'Template updated successfully',
        data: { template }
      });
    } catch (error) {
      logger.error('Update template failed', {
        error: error.message,
        templateId: req.params.id,
        updatedBy: req.user.id
      });
      next(error);
    }
  }

  // DELETE /api/v1/notifications/templates/:id
  async deleteTemplate(req, res, next) {
    try {
      const { id } = req.params;

      await NotificationService.deleteTemplate(id, req.user.id, req.user.role);

      logger.info('Notification template deleted', {
        templateId: id,
        deletedBy: req.user.id
      });

      res.status(200).json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      logger.error('Delete template failed', {
        error: error.message,
        templateId: req.params.id,
        deletedBy: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/sms
  async sendSMS(req, res, next) {
    try {
      const {
        recipient,
        message,
        type,
        eventId,
        priority,
        scheduledFor,
        template,
        templateData
      } = req.body;

      // Basic validation
      if (!recipient) {
        return next(ApiError.badRequest('Recipient is required'));
      }

      if (!message && !template) {
        return next(ApiError.badRequest('Message or template is required'));
      }

      const notification = await NotificationService.sendSMSNotification(
        {
          recipient,
          message,
          type,
          eventId,
          priority,
          scheduledFor,
          template,
          templateData
        },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('SMS notification sent successfully', {
        notificationId: notification._id,
        recipient,
        sentBy: req.user.id,
        type,
        scheduled: !!scheduledFor,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: scheduledFor ? 'SMS scheduled successfully' : 'SMS sent successfully',
        data: { notification }
      });
    } catch (error) {
      logger.error('Send SMS failed', {
        error: error.message,
        sentBy: req.user.id,
        recipient: req.body.recipient,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/bulk
  async sendBulkSMS(req, res, next) {
    try {
      const {
        recipients,
        message,
        type,
        eventId,
        priority,
        scheduledFor,
        template,
        templateData,
        filterCriteria
      } = req.body;

      // Basic validation
      if (!recipients && !filterCriteria) {
        return next(ApiError.badRequest('Recipients or filter criteria is required'));
      }

      if (!message && !template) {
        return next(ApiError.badRequest('Message or template is required'));
      }

      const results = await NotificationService.sendBulkSMSNotifications(
        {
          recipients,
          message,
          type,
          eventId,
          priority,
          scheduledFor,
          template,
          templateData,
          filterCriteria
        },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Bulk SMS notifications sent successfully', {
        totalRecipients: results.totalRecipients,
        successful: results.successful.length,
        failed: results.failed.length,
        sentBy: req.user.id,
        type,
        scheduled: !!scheduledFor,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: `Bulk SMS operation completed. ${results.successful.length} sent, ${results.failed.length} failed`,
        data: results
      });
    } catch (error) {
      logger.error('Send bulk SMS failed', {
        error: error.message,
        sentBy: req.user.id,
        recipientCount: req.body.recipients?.length || 'filter-based',
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/events/:eventId/reminders
  async sendEventReminders(req, res, next) {
    try {
      const { eventId } = req.params;
      const { reminderType = 'default' } = req.body;

      const results = await NotificationService.sendEventReminders(
        eventId,
        reminderType,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event reminders sent successfully', {
        eventId,
        eventTitle: results.eventTitle,
        reminderType,
        totalRecipients: results.totalRecipients,
        successful: results.successful.length,
        failed: results.failed.length,
        sentBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: `Event reminders sent. ${results.successful.length} successful, ${results.failed.length} failed`,
        data: results
      });
    } catch (error) {
      logger.error('Send event reminders failed', {
        error: error.message,
        eventId: req.params.eventId,
        sentBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/notifications
  async listNotifications(req, res, next) {
    try {
      const {
        page,
        limit,
        sort,
        status,
        type,
        eventId,
        sentBy,
        recipient,
        startDate,
        endDate,
        includeDeliveryStatus
      } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        sort: sort || '-createdAt',
        status,
        type,
        eventId,
        sentBy,
        recipient,
        startDate,
        endDate,
        includeDeliveryStatus: includeDeliveryStatus === 'true'
      };

      const filters = {
        scopedAccess: true,
        currentUserId: req.user.id,
        currentUserRole: req.user.role
      };

      const result = await NotificationService.getNotifications(filters, options);

      res.status(200).json({
        success: true,
        data: result.notifications,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('List notifications failed', {
        error: error.message,
        requestedBy: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/:id
  async getNotification(req, res, next) {
    try {
      const notification = await NotificationService.getNotificationById(req.params.id);

      // Basic access control - users can only see notifications they sent or received
      const canAccess = 
        notification.sentBy._id.toString() === req.user.id.toString() ||
        notification.recipient.userId?.toString() === req.user.id.toString() ||
        ['super_admin', 'senior_pastor', 'associate_pastor'].includes(req.user.role);

      if (!canAccess) {
        return next(ApiError.forbidden('Access denied'));
      }

      res.status(200).json({
        success: true,
        data: { notification }
      });
    } catch (error) {
      logger.error('Get notification failed', {
        error: error.message,
        notificationId: req.params.id,
        requestedBy: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/dashboard
  async getDashboard(req, res, next) {
    try {
      const { timeframe } = req.query;

      const options = {
        timeframe: parseInt(timeframe) || 30
      };

      const dashboard = await NotificationService.getNotificationDashboard(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error('Get notification dashboard failed', {
        error: error.message,
        requestedBy: req.user.id,
        options: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/retry-failed
  async retryFailedNotifications(req, res, next) {
    try {
      const { maxRetries = 3 } = req.body;

      // Check permissions - only high-level roles can retry failed notifications
      if (!['super_admin', 'senior_pastor', 'associate_pastor'].includes(req.user.role)) {
        return next(ApiError.forbidden('Insufficient permissions to retry failed notifications'));
      }

      const results = await NotificationService.retryFailedNotifications(maxRetries);

      logger.info('Failed notifications retry completed', {
        retried: results.retried,
        successful: results.successful,
        stillFailed: results.stillFailed,
        triggeredBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: `Retry completed. ${results.successful} successful, ${results.stillFailed} still failed`,
        data: results
      });
    } catch (error) {
      logger.error('Retry failed notifications failed', {
        error: error.message,
        triggeredBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/delivery-status/:id
  async getDeliveryStatus(req, res, next) {
    try {
      const notification = await NotificationService.getNotificationById(req.params.id);

      // Check access permissions
      const canAccess = 
        notification.sentBy._id.toString() === req.user.id.toString() ||
        ['super_admin', 'senior_pastor', 'associate_pastor'].includes(req.user.role);

      if (!canAccess) {
        return next(ApiError.forbidden('Access denied'));
      }

      // Get latest delivery status if available
      let currentStatus = null;
      if (notification.deliveryStatus?.trackingId) {
        try {
          const smsService = require('../config/sms');
          currentStatus = await smsService.getDeliveryStatus(notification.deliveryStatus.trackingId);
        } catch (error) {
          // Silently fail if delivery status check fails
          currentStatus = { error: 'Unable to fetch delivery status' };
        }
      }

      res.status(200).json({
        success: true,
        data: {
          notificationId: notification._id,
          status: notification.status,
          deliveryStatus: notification.deliveryStatus,
          currentStatus
        }
      });
    } catch (error) {
      logger.error('Get delivery status failed', {
        error: error.message,
        notificationId: req.params.id,
        requestedBy: req.user.id
      });
      next(error);
    }
  }

  // DELETE /api/v1/notifications/:id
  async deleteNotification(req, res, next) {
    try {
      const notification = await NotificationService.getNotificationById(req.params.id);

      // Check permissions - only sender or high-level roles can delete
      const canDelete = 
        notification.sentBy._id.toString() === req.user.id.toString() ||
        ['super_admin', 'senior_pastor'].includes(req.user.role);

      if (!canDelete) {
        return next(ApiError.forbidden('Access denied'));
      }

      // Only allow deletion of scheduled or failed notifications
      if (!['scheduled', 'failed'].includes(notification.status)) {
        return next(ApiError.badRequest('Can only delete scheduled or failed notifications'));
      }

      const Notification = require('../models/Notification.model');
      await Notification.findByIdAndDelete(req.params.id);

      logger.info('Notification deleted', {
        notificationId: req.params.id,
        deletedBy: req.user.id,
        originalStatus: notification.status,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      logger.error('Delete notification failed', {
        error: error.message,
        notificationId: req.params.id,
        deletedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/notifications/statistics
  async getStatistics(req, res, next) {
    try {
      const { timeframe = 30, type } = req.query;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(timeframe));

      // Apply scoped access based on user role
      const scopedQuery = NotificationService.applyScopedAccess(req.user.id, req.user.role);

      // Add type filter if specified
      if (type) {
        scopedQuery.type = type;
      }

      const statistics = await NotificationService.getNotificationStats(scopedQuery, startDate);
      const deliveryStats = await NotificationService.getDeliveryStats(scopedQuery, startDate);

      res.status(200).json({
        success: true,
        data: {
          period: { days: parseInt(timeframe), startDate },
          statistics,
          deliveryStatistics: deliveryStats
        }
      });
    } catch (error) {
      logger.error('Get notification statistics failed', {
        error: error.message,
        requestedBy: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/notifications/test
  async testNotification(req, res, next) {
    try {
      const { type, recipient, message = 'Test message from CAMS system' } = req.body;

      if (!recipient) {
        return next(ApiError.badRequest('Recipient is required for test'));
      }

      // Only allow high-level roles to send test notifications
      if (!['super_admin', 'senior_pastor'].includes(req.user.role)) {
        return next(ApiError.forbidden('Insufficient permissions to send test notifications'));
      }

      let notification;
      
      if (type === 'sms') {
        notification = await NotificationService.sendSMSNotification(
          {
            recipient,
            message: `${message} - Sent at ${new Date().toLocaleString()}`,
            type: 'test'
          },
          req.user.id,
          req.user.role,
          req.ip || req.connection.remoteAddress
        );
      } else if (type === 'email') {
        notification = await NotificationService.sendEmailNotification(
          {
            recipient,
            subject: 'CAMS Test Email',
            message: `${message} - Sent at ${new Date().toLocaleString()}`,
            type: 'test'
          },
          req.user.id,
          req.user.role,
          req.ip || req.connection.remoteAddress
        );
      } else {
        return next(ApiError.badRequest('Invalid notification type. Must be "sms" or "email"'));
      }

      logger.info('Test notification sent', {
        notificationId: notification._id,
        recipient,
        type,
        sentBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Test notification sent successfully',
        data: { notification }
      });
    } catch (error) {
      logger.error('Send test notification failed', {
        error: error.message,
        sentBy: req.user.id,
        recipient: req.body.recipient,
        type: req.body.type,
        ipAddress: req.ip
      });
      next(error);
    }
  }
}

module.exports = new NotificationController(); 
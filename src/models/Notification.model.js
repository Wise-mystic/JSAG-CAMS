const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../utils/constants');

// Notification Schema
const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(NOTIFICATION_TYPES),
    required: [true, 'Notification type is required'],
  },
  
  recipients: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed'],
      default: 'pending',
    },
    messageId: String, // SMS provider message ID
    deliveredAt: Date,
    failureReason: String,
  }],
  
  message: {
    content: {
      type: String,
      required: [true, 'Message content is required'],
      maxlength: [500, 'Message must not exceed 500 characters'],
    },
    template: {
      type: String,
      default: null,
    },
    variables: {
      type: Map,
      of: String,
    },
  },
  
  relatedEvent: {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    eventTitle: String,
    eventTime: Date,
  },
  
  scheduledFor: {
    type: Date,
    default: null,
  },
  
  sentAt: {
    type: Date,
    default: null,
  },
  
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'processing', 'sent', 'partial', 'failed', 'cancelled'],
    default: 'draft',
  },
  
  sender: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderName: String,
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
  },
  
  statistics: {
    totalRecipients: {
      type: Number,
      default: 0,
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    deliveredCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    cost: {
      amount: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: 'GHS',
      },
    },
  },
  
  retryConfig: {
    maxRetries: {
      type: Number,
      default: 3,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    nextRetryAt: Date,
  },
  
  metadata: {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: Date,
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancelledAt: Date,
    cancellationReason: String,
  },
  
  settings: {
    requireApproval: {
      type: Boolean,
      default: false,
    },
    allowUnsubscribe: {
      type: Boolean,
      default: true,
    },
    trackDelivery: {
      type: Boolean,
      default: true,
    },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ status: 1, scheduledFor: 1 });
notificationSchema.index({ 'sender.userId': 1, createdAt: -1 });
notificationSchema.index({ 'relatedEvent.eventId': 1 });
notificationSchema.index({ scheduledFor: 1, status: 1 });

// Pre-save middleware
notificationSchema.pre('save', async function(next) {
  try {
    // Update total recipients count
    this.statistics.totalRecipients = this.recipients.length;
    
    // Update sent count based on recipient statuses
    this.statistics.sentCount = this.recipients.filter(r => 
      ['sent', 'delivered'].includes(r.status)
    ).length;
    
    this.statistics.deliveredCount = this.recipients.filter(r => 
      r.status === 'delivered'
    ).length;
    
    this.statistics.failedCount = this.recipients.filter(r => 
      r.status === 'failed'
    ).length;
    
    // Update overall status based on recipient statuses
    if (this.statistics.failedCount === this.statistics.totalRecipients) {
      this.status = 'failed';
    } else if (this.statistics.sentCount === this.statistics.totalRecipients) {
      this.status = 'sent';
    } else if (this.statistics.sentCount > 0) {
      this.status = 'partial';
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
notificationSchema.methods = {
  // Send notification
  async send() {
    if (this.status !== 'scheduled' && this.status !== 'draft') {
      throw new Error('Notification has already been processed');
    }
    
    this.status = 'processing';
    await this.save();
    
    const smsService = require('../config/sms');
    const successfulRecipients = [];
    const failedRecipients = [];
    
    // Send to each recipient
    for (const recipient of this.recipients) {
      try {
        const result = await smsService.sendSMS(
          recipient.phoneNumber,
          this.message.content
        );
        
        recipient.status = 'sent';
        recipient.messageId = result.messageId;
        successfulRecipients.push(recipient);
      } catch (error) {
        recipient.status = 'failed';
        recipient.failureReason = error.message;
        failedRecipients.push(recipient);
      }
    }
    
    this.sentAt = new Date();
    
    // Calculate cost (example: 0.05 GHS per SMS)
    this.statistics.cost.amount = successfulRecipients.length * 0.05;
    
    await this.save();
    
    return {
      successful: successfulRecipients.length,
      failed: failedRecipients.length,
      total: this.recipients.length,
    };
  },
  
  // Schedule notification
  async schedule(scheduledTime) {
    if (this.status !== 'draft') {
      throw new Error('Only draft notifications can be scheduled');
    }
    
    if (scheduledTime <= new Date()) {
      throw new Error('Scheduled time must be in the future');
    }
    
    this.scheduledFor = scheduledTime;
    this.status = 'scheduled';
    await this.save();
  },
  
  // Cancel notification
  async cancel(userId, reason) {
    if (['sent', 'failed', 'cancelled'].includes(this.status)) {
      throw new Error('Cannot cancel notification in current status');
    }
    
    this.status = 'cancelled';
    this.metadata.cancelledBy = userId;
    this.metadata.cancelledAt = new Date();
    this.metadata.cancellationReason = reason;
    await this.save();
  },
  
  // Add recipients
  async addRecipients(userIds) {
    const User = mongoose.model('User');
    const users = await User.find({
      _id: { $in: userIds },
      isActive: true,
      'preferences.notificationEnabled': true,
    }).select('phoneNumber');
    
    const newRecipients = users.map(user => ({
      userId: user._id,
      phoneNumber: user.phoneNumber,
      status: 'pending',
    }));
    
    // Remove duplicates
    const existingPhones = this.recipients.map(r => r.phoneNumber);
    const uniqueRecipients = newRecipients.filter(r => 
      !existingPhones.includes(r.phoneNumber)
    );
    
    this.recipients.push(...uniqueRecipients);
    await this.save();
    
    return uniqueRecipients.length;
  },
  
  // Update delivery status
  async updateDeliveryStatus(messageId, status) {
    const recipient = this.recipients.find(r => r.messageId === messageId);
    
    if (!recipient) {
      throw new Error('Recipient not found');
    }
    
    recipient.status = status;
    if (status === 'delivered') {
      recipient.deliveredAt = new Date();
    }
    
    await this.save();
  },
  
  // Retry failed notifications
  async retryFailed() {
    if (this.retryConfig.retryCount >= this.retryConfig.maxRetries) {
      throw new Error('Maximum retry attempts reached');
    }
    
    const failedRecipients = this.recipients.filter(r => r.status === 'failed');
    
    if (failedRecipients.length === 0) {
      throw new Error('No failed recipients to retry');
    }
    
    const smsService = require('../config/sms');
    let retryCount = 0;
    
    for (const recipient of failedRecipients) {
      try {
        const result = await smsService.sendSMS(
          recipient.phoneNumber,
          this.message.content
        );
        
        recipient.status = 'sent';
        recipient.messageId = result.messageId;
        recipient.failureReason = null;
        retryCount++;
      } catch (error) {
        recipient.failureReason = error.message;
      }
    }
    
    this.retryConfig.retryCount++;
    this.retryConfig.nextRetryAt = new Date(Date.now() + (this.retryConfig.retryCount * 5 * 60 * 1000)); // Exponential backoff
    await this.save();
    
    return retryCount;
  },
  
  // Generate message from template
  async generateFromTemplate(templateName, variables) {
    // This would integrate with a template system
    // For now, simple variable replacement
    let content = this.message.content;
    
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    
    this.message.content = content;
    this.message.template = templateName;
    this.message.variables = variables;
    
    await this.save();
  },
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    
    // Remove phone numbers for privacy
    obj.recipients = obj.recipients.map(r => ({
      ...r,
      phoneNumber: r.phoneNumber.replace(/\d{4}$/, '****'),
    }));
    
    delete obj.__v;
    return obj;
  },
};

// Static methods
notificationSchema.statics = {
  // Create event reminder notification
  async createEventReminder(event, reminderTime) {
    const User = mongoose.model('User');
    const participants = await User.find({
      _id: { $in: event.expectedParticipants },
      isActive: true,
      'preferences.eventReminders': true,
    }).select('phoneNumber');
    
    const notification = new this({
      type: NOTIFICATION_TYPES.EVENT_REMINDER,
      recipients: participants.map(user => ({
        userId: user._id,
        phoneNumber: user.phoneNumber,
        status: 'pending',
      })),
      message: {
        content: `Reminder: ${event.title} starts at ${event.startTime.toLocaleString()}. We look forward to seeing you!`,
      },
      relatedEvent: {
        eventId: event._id,
        eventTitle: event.title,
        eventTime: event.startTime,
      },
      scheduledFor: reminderTime,
      sender: {
        userId: event.createdBy,
      },
      priority: 'normal',
      status: 'scheduled',
    });
    
    await notification.save();
    return notification;
  },
  
  // Get scheduled notifications ready to send
  async getScheduledNotifications() {
    const now = new Date();
    return await this.find({
      status: 'scheduled',
      scheduledFor: { $lte: now },
    });
  },
  
  // Get notification statistics
  async getNotificationStatistics(filter = {}) {
    const match = { ...filter };
    
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          totalRecipients: { $sum: '$statistics.totalRecipients' },
          totalSent: { $sum: '$statistics.sentCount' },
          totalDelivered: { $sum: '$statistics.deliveredCount' },
          totalFailed: { $sum: '$statistics.failedCount' },
          totalCost: { $sum: '$statistics.cost.amount' },
          byType: {
            $push: {
              type: '$type',
              count: 1,
            },
          },
          byStatus: {
            $push: {
              status: '$status',
              count: 1,
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalNotifications: 1,
          totalRecipients: 1,
          totalSent: 1,
          totalDelivered: 1,
          totalFailed: 1,
          totalCost: 1,
          deliveryRate: {
            $cond: [
              { $eq: ['$totalSent', 0] },
              0,
              { $multiply: [{ $divide: ['$totalDelivered', '$totalSent'] }, 100] },
            ],
          },
        },
      },
    ];
    
    const results = await this.aggregate(pipeline);
    return results[0] || {
      totalNotifications: 0,
      totalRecipients: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalCost: 0,
      deliveryRate: 0,
    };
  },
  
  // Search notifications
  async searchNotifications(query, options = {}) {
    const searchQuery = {
      $or: [
        { 'message.content': new RegExp(query, 'i') },
        { 'relatedEvent.eventTitle': new RegExp(query, 'i') },
      ],
    };
    
    if (options.type) {
      searchQuery.type = options.type;
    }
    
    if (options.status) {
      searchQuery.status = options.status;
    }
    
    if (options.senderId) {
      searchQuery['sender.userId'] = options.senderId;
    }
    
    return await this.find(searchQuery)
      .populate('sender.userId', 'fullName')
      .populate('relatedEvent.eventId', 'title')
      .sort('-createdAt')
      .limit(options.limit || 50);
  },
};

// Create and export the model
const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification; 
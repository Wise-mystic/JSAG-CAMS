const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../utils/constants');

// Audit Log Schema
const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // Making userId optional to handle system actions
    required: false,
  },
  
  action: {
    type: String,
    enum: Object.values(AUDIT_ACTIONS),
    required: [true, 'Action is required'],
  },
  
  resource: {
    type: String,
    required: [true, 'Resource is required'],
    enum: ['user', 'department', 'ministry', 'event', 'attendance', 'prayer-tribe', 'system'],
  },
  
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  changes: {
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  
  ipAddress: {
    type: String,
    default: null,
  },
  
  userAgent: {
    type: String,
    default: null,
  },
  
  location: {
    country: String,
    city: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
  },
  
  metadata: {
    requestId: String,
    sessionId: String,
    apiVersion: String,
    appVersion: String,
    platform: {
      type: String,
      enum: ['web', 'mobile', 'api'],
    },
  },
  
  result: {
    success: {
      type: Boolean,
      default: true,
    },
    error: {
      message: String,
      code: String,
      stack: String,
    },
  },
  
  duration: {
    type: Number, // Operation duration in milliseconds
    default: null,
  },
  
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: false, // We use custom timestamp field
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for performance
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, timestamp: -1 });
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ 'result.success': 1, timestamp: -1 });

// TTL index for automatic log cleanup (optional - keeps logs for 2 years)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 }); // 2 years

// Instance methods
auditLogSchema.methods = {
  // Format log entry for display
  format() {
    const user = this.userId ? `User ${this.userId}` : 'System';
    const resource = this.resourceId ? `${this.resource} ${this.resourceId}` : this.resource;
    const status = this.result.success ? 'SUCCESS' : 'FAILED';
    
    return `[${this.timestamp.toISOString()}] ${user} ${this.action} on ${resource} - ${status}`;
  },
  
  // Get action description
  getActionDescription() {
    const actionDescriptions = {
      // User actions
      'user.register': 'registered a new account',
      'user.login': 'logged in',
      'user.logout': 'logged out',
      'user.update': 'updated user information',
      'user.delete': 'deleted user account',
      'user.role_change': 'changed user role',
      'user.password_change': 'changed password',
      
      // Department actions
      'department.create': 'created department',
      'department.update': 'updated department',
      'department.delete': 'deleted department',
      'department.member_add': 'added member to department',
      'department.member_remove': 'removed member from department',
      'department.leader_assign': 'assigned department leader',
      
      // Event actions
      'event.create': 'created event',
      'event.update': 'updated event',
      'event.delete': 'deleted event',
      'event.cancel': 'cancelled event',
      'event.complete': 'completed event',
      'event.participant_add': 'added participant to event',
      'event.participant_remove': 'removed participant from event',
      
      // Attendance actions
      'attendance.mark': 'marked attendance',
      'attendance.bulk_mark': 'marked bulk attendance',
      'attendance.update': 'updated attendance',
      'attendance.delete': 'deleted attendance record',
      
      // Ministry actions
      'ministry.create': 'created ministry',
      'ministry.update': 'updated ministry',
      'ministry.delete': 'deleted ministry',
      'ministry.member_add': 'added member to ministry',
      'ministry.member_remove': 'removed member from ministry',
      
      // Prayer Tribe actions
      'prayer_tribe.create': 'created prayer tribe',
      'prayer_tribe.update': 'updated prayer tribe',
      'prayer_tribe.delete': 'deleted prayer tribe',
      'prayer_tribe.member_add': 'added member to prayer tribe',
      'prayer_tribe.member_remove': 'removed member from prayer tribe',
      
      // System actions
      'system.backup': 'performed system backup',
      'system.restore': 'restored system from backup',
      'system.config_update': 'updated system configuration',
    };
    
    return actionDescriptions[this.action] || this.action;
  },
  
  // Check if log entry contains sensitive data
  containsSensitiveData() {
    const sensitiveActions = [
      'user.password_change',
      'user.login',
      'system.config_update',
    ];
    
    return sensitiveActions.includes(this.action);
  },
  
  // Convert to safe JSON (remove sensitive data)
  toSafeJSON() {
    const obj = this.toObject();
    
    if (this.containsSensitiveData()) {
      // Remove sensitive details
      if (obj.details && obj.details.password) {
        obj.details.password = '[REDACTED]';
      }
      if (obj.changes && obj.changes.before && obj.changes.before.password) {
        obj.changes.before.password = '[REDACTED]';
      }
      if (obj.changes && obj.changes.after && obj.changes.after.password) {
        obj.changes.after.password = '[REDACTED]';
      }
    }
    
    delete obj.__v;
    return obj;
  },
};

// Static methods
auditLogSchema.statics = {
  // Log an action
  async logAction(data) {
    try {
      const log = new this(data);
      await log.save();
      return log;
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't throw error to prevent disrupting main operation
      return null;
    }
  },
  
  // Get user activity logs
  async getUserActivity(userId, options = {}) {
    const query = { userId };
    
    if (options.dateRange) {
      query.timestamp = {};
      if (options.dateRange.from) {
        query.timestamp.$gte = options.dateRange.from;
      }
      if (options.dateRange.to) {
        query.timestamp.$lte = options.dateRange.to;
      }
    }
    
    if (options.action) {
      query.action = options.action;
    }
    
    if (options.resource) {
      query.resource = options.resource;
    }
    
    return await this.find(query)
      .sort('-timestamp')
      .limit(options.limit || 100)
      .skip(options.skip || 0);
  },
  
  // Get resource history
  async getResourceHistory(resource, resourceId, options = {}) {
    const query = { resource, resourceId };
    
    if (options.dateRange) {
      query.timestamp = {};
      if (options.dateRange.from) {
        query.timestamp.$gte = options.dateRange.from;
      }
      if (options.dateRange.to) {
        query.timestamp.$lte = options.dateRange.to;
      }
    }
    
    return await this.find(query)
      .populate('userId', 'fullName email role')
      .sort('-timestamp')
      .limit(options.limit || 50);
  },
  
  // Get failed operations
  async getFailedOperations(options = {}) {
    const query = { 'result.success': false };
    
    if (options.dateRange) {
      query.timestamp = {};
      if (options.dateRange.from) {
        query.timestamp.$gte = options.dateRange.from;
      }
      if (options.dateRange.to) {
        query.timestamp.$lte = options.dateRange.to;
      }
    }
    
    return await this.find(query)
      .populate('userId', 'fullName email')
      .sort('-timestamp')
      .limit(options.limit || 100);
  },
  
  // Get audit statistics
  async getAuditStatistics(dateRange = {}) {
    const match = {};
    
    if (dateRange.from || dateRange.to) {
      match.timestamp = {};
      if (dateRange.from) match.timestamp.$gte = dateRange.from;
      if (dateRange.to) match.timestamp.$lte = dateRange.to;
    }
    
    const pipeline = [
      { $match: match },
      {
        $facet: {
          byAction: [
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byResource: [
            { $group: { _id: '$resource', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byUser: [
            { $group: { _id: '$userId', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          bySuccess: [
            { $group: { _id: '$result.success', count: { $sum: 1 } } },
          ],
          hourlyDistribution: [
            {
              $group: {
                _id: { $hour: '$timestamp' },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ];
    
    const results = await this.aggregate(pipeline);
    return results[0] || {};
  },
  
  // Search audit logs
  async searchLogs(searchQuery, options = {}) {
    const query = {
      $or: [
        { action: new RegExp(searchQuery, 'i') },
        { 'details.description': new RegExp(searchQuery, 'i') },
        { 'result.error.message': new RegExp(searchQuery, 'i') },
      ],
    };
    
    if (options.userId) {
      query.userId = options.userId;
    }
    
    if (options.dateRange) {
      query.timestamp = {};
      if (options.dateRange.from) {
        query.timestamp.$gte = options.dateRange.from;
      }
      if (options.dateRange.to) {
        query.timestamp.$lte = options.dateRange.to;
      }
    }
    
    return await this.find(query)
      .populate('userId', 'fullName email')
      .sort('-timestamp')
      .limit(options.limit || 50);
  },
  
  // Clean old logs (manual trigger)
  async cleanOldLogs(daysToKeep = 730) { // Default 2 years
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await this.deleteMany({
      timestamp: { $lt: cutoffDate },
    });
    
    return result.deletedCount;
  },
};

// Create and export the model
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog; 
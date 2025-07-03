const mongoose = require('mongoose');
const { EVENT_TYPES, EVENT_STATUS, TARGET_AUDIENCE } = require('../utils/constants');

// Event Schema
const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
    minlength: [3, 'Event title must be at least 3 characters'],
    maxlength: [200, 'Event title must not exceed 200 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description must not exceed 1000 characters'],
  },
  
  eventType: {
    type: String,
    enum: Object.values(EVENT_TYPES),
    required: [true, 'Event type is required'],
  },
  
  startTime: {
    type: Date,
    required: [true, 'Event start time is required'],
    validate: {
      validator: function(value) {
        return value > new Date();
      },
      message: 'Event start time must be in the future',
    },
  },
  
  endTime: {
    type: Date,
    required: [true, 'Event end time is required'],
    validate: {
      validator: function(value) {
        return value > this.startTime;
      },
      message: 'Event end time must be after start time',
    },
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  
  ministryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ministry',
    default: null,
  },
  
  targetAudience: {
    type: String,
    enum: Object.values(TARGET_AUDIENCE),
    required: [true, 'Target audience is required'],
  },
  
  targetIds: [{
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'targetAudience',
  }],
  
  expectedParticipants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  
  actualParticipants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  
  isRecurring: {
    type: Boolean,
    default: false,
  },
  
  recurrenceRule: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'bi-weekly', 'monthly'],
    },
    interval: {
      type: Number,
      default: 1,
    },
    daysOfWeek: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }],
    endDate: Date,
    exceptions: [Date], // Dates to skip
  },
  
  parentEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    default: null, // For recurring events
  },
  
  status: {
    type: String,
    enum: Object.values(EVENT_STATUS),
    default: EVENT_STATUS.DRAFT,
  },
  
  autoCloseAt: {
    type: Date,
    default: null,
  },
  
  isClosed: {
    type: Boolean,
    default: false,
  },
  
  closedAt: {
    type: Date,
    default: null,
  },
  
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  
  location: {
    name: String,
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
  },
  
  notifications: [{
    time: Date,
    message: String,
    sent: {
      type: Boolean,
      default: false,
    },
    sentAt: Date,
    recipients: Number,
  }],
  
  settings: {
    requiresRSVP: {
      type: Boolean,
      default: false,
    },
    maxParticipants: {
      type: Number,
      default: null,
    },
    allowWalkIns: {
      type: Boolean,
      default: true,
    },
    sendReminders: {
      type: Boolean,
      default: true,
    },
    reminderTimes: [{
      type: Number, // Minutes before event
      default: [1440, 720, 360, 180, 60, 30], // 24h, 12h, 6h, 3h, 1h, 30min
    }],
  },
  
  metadata: {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    attendanceMarked: {
      type: Boolean,
      default: false,
    },
    totalAttended: {
      type: Number,
      default: 0,
    },
    totalAbsent: {
      type: Number,
      default: 0,
    },
    totalExcused: {
      type: Number,
      default: 0,
    },
    totalLate: {
      type: Number,
      default: 0,
    },
  },
  
  customFields: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
eventSchema.index({ startTime: 1, departmentId: 1 });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ status: 1, startTime: 1 });
eventSchema.index({ targetAudience: 1, targetIds: 1 });
eventSchema.index({ eventType: 1 });
eventSchema.index({ isClosed: 1 });
eventSchema.index({ title: 'text', description: 'text' });

// Virtual for duration
eventSchema.virtual('duration').get(function() {
  return this.endTime - this.startTime;
});

// Virtual for attendance records
eventSchema.virtual('attendanceRecords', {
  ref: 'Attendance',
  localField: '_id',
  foreignField: 'eventId',
});

// Pre-save middleware
eventSchema.pre('save', async function(next) {
  try {
    // Set auto-close time (3 hours after end time)
    if (!this.autoCloseAt && this.endTime) {
      this.autoCloseAt = new Date(this.endTime.getTime() + (3 * 60 * 60 * 1000));
    }
    
    // Update status based on time
    const now = new Date();
    if (!this.isClosed) {
      if (now < this.startTime) {
        this.status = EVENT_STATUS.UPCOMING;
      } else if (now >= this.startTime && now <= this.endTime) {
        this.status = EVENT_STATUS.ACTIVE;
      } else if (now > this.endTime) {
        this.status = EVENT_STATUS.COMPLETED;
      }
    }
    
    // Generate notification times if not set
    if (this.settings.sendReminders && this.notifications.length === 0) {
      this.notifications = this.settings.reminderTimes.map(minutes => ({
        time: new Date(this.startTime.getTime() - (minutes * 60 * 1000)),
        message: `Reminder: ${this.title} starts in ${this.formatReminderTime(minutes)}`,
        sent: false,
      }));
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
eventSchema.methods = {
  // Format reminder time
  formatReminderTime(minutes) {
    if (minutes < 60) {
      return `${minutes} minutes`;
    } else if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const days = Math.floor(minutes / 1440);
      return `${days} day${days > 1 ? 's' : ''}`;
    }
  },
  
  // Check if user can access event
  async canUserAccess(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user) return false;
    
    // Super admin and senior pastor can access all events
    if (['super-admin', 'senior-pastor'].includes(user.role)) {
      return true;
    }
    
    // Check based on target audience
    switch (this.targetAudience) {
      case TARGET_AUDIENCE.ALL:
        return true;
        
      case TARGET_AUDIENCE.DEPARTMENT:
        return this.targetIds.some(id => id.equals(user.departmentId));
        
      case TARGET_AUDIENCE.MINISTRY:
        return this.targetIds.some(id => id.equals(user.ministryId));
        
      case TARGET_AUDIENCE.PRAYER_TRIBE:
        return user.prayerTribes.some(tribeId => 
          this.targetIds.some(id => id.equals(tribeId))
        );
        
      case TARGET_AUDIENCE.SUBGROUP:
        return user.subgroups.some(subgroupId => 
          this.targetIds.some(id => id.equals(subgroupId))
        );
        
      case TARGET_AUDIENCE.CUSTOM:
        return this.expectedParticipants.some(id => id.equals(userId));
        
      default:
        return false;
    }
  },
  
  // Add participant
  async addParticipant(userId) {
    if (!this.expectedParticipants.some(id => id.equals(userId))) {
      this.expectedParticipants.push(userId);
      await this.save();
    }
  },
  
  // Remove participant
  async removeParticipant(userId) {
    this.expectedParticipants = this.expectedParticipants.filter(
      id => !id.equals(userId)
    );
    await this.save();
  },
  
  // Close event
  async closeEvent(closedByUserId) {
    if (this.isClosed) {
      throw new Error('Event is already closed');
    }
    
    this.isClosed = true;
    this.closedAt = new Date();
    this.closedBy = closedByUserId;
    this.status = EVENT_STATUS.CLOSED;
    
    // Update attendance statistics
    const Attendance = mongoose.model('Attendance');
    const attendanceStats = await Attendance.aggregate([
      { $match: { eventId: this._id } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 }
      }}
    ]);
    
    attendanceStats.forEach(stat => {
      switch (stat._id) {
        case 'present':
          this.metadata.totalAttended = stat.count;
          break;
        case 'absent':
          this.metadata.totalAbsent = stat.count;
          break;
        case 'excused':
          this.metadata.totalExcused = stat.count;
          break;
        case 'late':
          this.metadata.totalLate = stat.count;
          break;
      }
    });
    
    this.metadata.attendanceMarked = true;
    await this.save();
  },
  
  // Reopen event (within 24 hours)
  async reopenEvent() {
    if (!this.isClosed) {
      throw new Error('Event is not closed');
    }
    
    const hoursSinceClosure = (Date.now() - this.closedAt) / (1000 * 60 * 60);
    if (hoursSinceClosure > 24) {
      throw new Error('Cannot reopen event after 24 hours');
    }
    
    this.isClosed = false;
    this.closedAt = null;
    this.closedBy = null;
    this.status = EVENT_STATUS.COMPLETED;
    
    await this.save();
  },
  
  // Create recurring events
  async createRecurringEvents() {
    if (!this.isRecurring || !this.recurrenceRule) {
      throw new Error('This is not a recurring event');
    }
    
    const events = [];
    const { frequency, interval, endDate, exceptions } = this.recurrenceRule;
    
    let currentDate = new Date(this.startTime);
    const endRecurrence = endDate || new Date(currentDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year default
    
    while (currentDate <= endRecurrence) {
      // Skip if date is in exceptions
      if (!exceptions || !exceptions.some(exc => exc.getTime() === currentDate.getTime())) {
        const newEvent = new (mongoose.model('Event'))({
          ...this.toObject(),
          _id: undefined,
          startTime: new Date(currentDate),
          endTime: new Date(currentDate.getTime() + this.duration),
          parentEventId: this._id,
          isRecurring: false,
          recurrenceRule: undefined,
          status: EVENT_STATUS.UPCOMING,
          isClosed: false,
          notifications: [],
          createdAt: undefined,
          updatedAt: undefined,
        });
        
        events.push(newEvent);
      }
      
      // Calculate next occurrence
      switch (frequency) {
        case 'daily':
          currentDate.setDate(currentDate.getDate() + interval);
          break;
        case 'weekly':
          currentDate.setDate(currentDate.getDate() + (7 * interval));
          break;
        case 'bi-weekly':
          currentDate.setDate(currentDate.getDate() + (14 * interval));
          break;
        case 'monthly':
          currentDate.setMonth(currentDate.getMonth() + interval);
          break;
      }
    }
    
    return await mongoose.model('Event').insertMany(events);
  },
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.__v;
    return obj;
  },
};

// Static methods
eventSchema.statics = {
  // Find upcoming events
  async findUpcoming(filter = {}) {
    return await this.find({
      ...filter,
      startTime: { $gt: new Date() },
      status: { $ne: EVENT_STATUS.CANCELLED },
    }).sort('startTime');
  },
  
  // Find active events
  async findActive(filter = {}) {
    const now = new Date();
    return await this.find({
      ...filter,
      startTime: { $lte: now },
      endTime: { $gte: now },
      status: EVENT_STATUS.ACTIVE,
    });
  },
  
  // Find events needing closure
  async findEventsToClose() {
    const now = new Date();
    return await this.find({
      autoCloseAt: { $lte: now },
      isClosed: false,
      status: { $ne: EVENT_STATUS.CANCELLED },
    });
  },
  
  // Find events by department
  async findByDepartment(departmentId, includeSubdepartments = false) {
    const filter = { departmentId };
    
    if (includeSubdepartments) {
      const Department = mongoose.model('Department');
      const dept = await Department.findById(departmentId);
      const subdepts = await dept.getAllSubdepartments();
      const deptIds = [departmentId, ...subdepts.map(d => d._id)];
      
      filter.departmentId = { $in: deptIds };
    }
    
    return await this.find(filter).sort('-startTime');
  },
  
  // Get event statistics
  async getEventStatistics(eventId) {
    const event = await this.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }
    
    const Attendance = mongoose.model('Attendance');
    const attendanceStats = await Attendance.aggregate([
      { $match: { eventId: mongoose.Types.ObjectId(eventId) } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 }
      }}
    ]);
    
    const stats = {
      eventId,
      title: event.title,
      expectedParticipants: event.expectedParticipants.length,
      attendance: {
        present: 0,
        absent: 0,
        excused: 0,
        late: 0,
      },
      attendanceRate: 0,
    };
    
    attendanceStats.forEach(stat => {
      stats.attendance[stat._id] = stat.count;
    });
    
    const totalMarked = Object.values(stats.attendance).reduce((a, b) => a + b, 0);
    if (totalMarked > 0) {
      stats.attendanceRate = ((stats.attendance.present + stats.attendance.late) / totalMarked) * 100;
    }
    
    return stats;
  },
};

// Create and export the model
const Event = mongoose.model('Event', eventSchema);

module.exports = Event; 
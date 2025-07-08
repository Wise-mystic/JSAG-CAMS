const mongoose = require('mongoose');
const { EVENT_TYPES, EVENT_STATUS, TARGET_AUDIENCE } = require('../utils/constants');

// Import related models to ensure they are registered
require('./Subgroup.model');

// Event Schema
const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    default: 'Untitled Event',
    trim: true,
    maxlength: [200, 'Event title must not exceed 200 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description must not exceed 1000 characters'],
    default: '',
  },
  
  eventType: {
    type: String,
    enum: Object.values(EVENT_TYPES),
    default: EVENT_TYPES.MEETING,
  },
  
  startTime: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
  },
  
  endTime: {
    type: Date,
    default: () => new Date(Date.now() + 25 * 60 * 60 * 1000), // Tomorrow + 1 hour
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
  
  prayerTribeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PrayerTribe',
    default: null,
  },
  
  assignedClockerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  
  targetAudience: {
    type: String,
    enum: Object.values(TARGET_AUDIENCE),
    default: 'all',
  },
  
  targetIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'targetAudience',
    }],
    default: [],
  },

  // Enhanced group-based participant selection
  groupSelection: {
    // Primary group selection
    groupType: {
      type: String,
      enum: ['all', 'department', 'ministry', 'prayer-tribe', 'subgroup', 'custom'],
      default: 'all',
    },
    
    // Primary group ID (department, ministry, or prayer tribe)
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      refPath: 'groupSelection.groupType',
    },
    
    // Optional subgroup within the primary group
    subgroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subgroup',
      default: null,
    },
    
    // Include all subgroups of the selected group
    includeSubgroups: {
      type: Boolean,
      default: false,
    },
    
    // Auto-populate participants based on group selection
    autoPopulateParticipants: {
      type: Boolean,
      default: true,
    },
    
    // Last time participants were populated from groups
    lastPopulatedAt: {
      type: Date,
      default: null,
    },
  },
  
  participants: {
    type: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      registeredAt: {
        type: Date,
        default: Date.now,
      },
      registeredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      attended: {
        type: Boolean,
        default: false,
      },
      status: {
        type: String,
        enum: ['registered', 'confirmed', 'attended', 'absent', 'excused'],
        default: 'registered',
      },
      notes: String
    }],
    default: [],
  },
  
  expectedParticipants: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    default: [],
  },
  
  actualParticipants: {
    type: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      addedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    default: [],
  },
  
  isRecurring: {
    type: Boolean,
    default: false,
  },
  
  recurrenceRule: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'bi-weekly', 'monthly'],
      default: 'weekly',
    },
    interval: {
      type: Number,
      default: 1,
    },
    daysOfWeek: {
      type: [{
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      }],
      default: [],
    },
    endDate: {
      type: Date,
      default: null,
    },
    exceptions: {
      type: [Date],
      default: [],
    },
  },
  
  status: {
    type: String,
    enum: Object.values(EVENT_STATUS),
    default: EVENT_STATUS.DRAFT,
  },
  
  requiresAttendance: {
    type: Boolean,
    default: false,
  },
  
  isPublic: {
    type: Boolean,
    default: false,
  },
  
  sendReminders: {
    type: Boolean,
    default: true,
  },
  
  reminderTimes: {
    type: [Number],
    default: [1440, 60], // 24h and 1h before
  },
  
  autoCloseAt: {
    type: Date,
    default: null,
  },
  
  location: {
    name: {
      type: String,
      default: '',
    },
    address: {
      type: String,
      default: '',
    },
    coordinates: {
      latitude: {
        type: Number,
        default: null,
      },
      longitude: {
        type: Number,
        default: null,
      },
    },
  },
  
  notifications: {
    type: [{
      time: Date,
      message: String,
      sent: {
        type: Boolean,
        default: false,
      },
      sentAt: Date,
      recipients: Number,
    }],
    default: [],
  },
  
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
    reminderTimes: {
      type: [Number],
      default: [1440, 60],
    },
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
  
  // Missing fields
  parentEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
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
}, {
  timestamps: true,
  strict: false // Allow any additional fields
});

// Indexes
eventSchema.index({ startTime: 1, departmentId: 1 });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ status: 1, startTime: 1 });
eventSchema.index({ targetAudience: 1, targetIds: 1 });
eventSchema.index({ eventType: 1 });
eventSchema.index({ isClosed: 1 });
eventSchema.index({ assignedClockerId: 1 });
eventSchema.index({ 'participants.userId': 1 });
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
    
    // Initialize notifications array if not exists
    if (!this.notifications) {
      this.notifications = [];
    }
    
    // Generate notification times if not set
    if (this.settings && this.settings.sendReminders && this.notifications.length === 0) {
      const reminderTimes = this.settings.reminderTimes || [1440, 60];
      this.notifications = reminderTimes.map(minutes => ({
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

  // Populate participants based on group selection
  async populateParticipantsFromGroups() {
    if (!this.groupSelection.autoPopulateParticipants || this.groupSelection.groupType === 'custom') {
      return false;
    }

    const User = mongoose.model('User');
    const Subgroup = mongoose.model('Subgroup');
    const Department = mongoose.model('Department');
    const Ministry = mongoose.model('Ministry');
    const PrayerTribe = mongoose.model('PrayerTribe');
    
    let participants = [];

    try {
      switch (this.groupSelection.groupType) {
        case 'all':
          participants = await User.find({ isActive: true }).select('_id');
          break;

        case 'department':
          if (this.groupSelection.subgroupId) {
            // Get members of specific subgroup within the department
            const subgroup = await Subgroup.findById(this.groupSelection.subgroupId);
            if (subgroup && subgroup.parentType === 'department' && subgroup.parentId.equals(this.groupSelection.groupId)) {
              participants = await subgroup.getMembers();
            }
          } else if (this.groupSelection.includeSubgroups) {
            // Get all members of department and its subgroups
            const departmentMembers = await User.find({ 
              departmentIds: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
            
            const subgroups = await Subgroup.findByParent('department', this.groupSelection.groupId);
            const subgroupMembers = [];
            for (const subgroup of subgroups) {
              const members = await subgroup.getMembers();
              subgroupMembers.push(...members);
            }
            
            participants = [...departmentMembers, ...subgroupMembers];
          } else {
            // Get only direct department members (excluding subgroups)
            participants = await User.find({ 
              departmentIds: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
          }
          break;

        case 'ministry':
          if (this.groupSelection.subgroupId) {
            // Get members of specific subgroup within the ministry
            const subgroup = await Subgroup.findById(this.groupSelection.subgroupId);
            if (subgroup && subgroup.parentType === 'ministry' && subgroup.parentId.equals(this.groupSelection.groupId)) {
              participants = await subgroup.getMembers();
            }
          } else if (this.groupSelection.includeSubgroups) {
            // Get all members of ministry and its subgroups
            const ministryMembers = await User.find({ 
              ministryId: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
            
            const subgroups = await Subgroup.findByParent('ministry', this.groupSelection.groupId);
            const subgroupMembers = [];
            for (const subgroup of subgroups) {
              const members = await subgroup.getMembers();
              subgroupMembers.push(...members);
            }
            
            participants = [...ministryMembers, ...subgroupMembers];
          } else {
            // Get only direct ministry members (excluding subgroups)
            participants = await User.find({ 
              ministryId: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
          }
          break;

        case 'prayer-tribe':
          if (this.groupSelection.subgroupId) {
            // Get members of specific subgroup within the prayer tribe
            const subgroup = await Subgroup.findById(this.groupSelection.subgroupId);
            if (subgroup && subgroup.parentType === 'prayer-tribe' && subgroup.parentId.equals(this.groupSelection.groupId)) {
              participants = await subgroup.getMembers();
            }
          } else if (this.groupSelection.includeSubgroups) {
            // Get all members of prayer tribe and its subgroups
            const tribeMembers = await User.find({ 
              prayerTribeId: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
            
            const subgroups = await Subgroup.findByParent('prayer-tribe', this.groupSelection.groupId);
            const subgroupMembers = [];
            for (const subgroup of subgroups) {
              const members = await subgroup.getMembers();
              subgroupMembers.push(...members);
            }
            
            participants = [...tribeMembers, ...subgroupMembers];
          } else {
            // Get only direct prayer tribe members (excluding subgroups)
            participants = await User.find({ 
              prayerTribeId: this.groupSelection.groupId, 
              isActive: true 
            }).select('_id');
          }
          break;

        case 'subgroup':
          // Get members of the specific subgroup
          if (this.groupSelection.subgroupId) {
            const subgroup = await Subgroup.findById(this.groupSelection.subgroupId);
            if (subgroup) {
              participants = await subgroup.getMembers();
            }
          }
          break;

        default:
          return false;
      }

      // Remove duplicates and convert to ObjectIds
      const uniqueParticipantIds = [...new Set(participants.map(p => p._id || p).map(id => id.toString()))];
      
      // Update expectedParticipants
      this.expectedParticipants = uniqueParticipantIds.map(id => new mongoose.Types.ObjectId(id));
      this.groupSelection.lastPopulatedAt = new Date();
      
      await this.save();
      return true;

    } catch (error) {
      console.error('Error populating participants from groups:', error);
      return false;
    }
  },

  // Get available groups for user based on permissions
  async getAvailableGroupsForUser(userId) {
    const User = mongoose.model('User');
    const Department = mongoose.model('Department');
    const Ministry = mongoose.model('Ministry');
    const PrayerTribe = mongoose.model('PrayerTribe');
    const Subgroup = mongoose.model('Subgroup');
    
    const user = await User.findById(userId).populate('departmentIds ministryId prayerTribeId');
    
    if (!user) return { departments: [], ministries: [], prayerTribes: [], subgroups: [] };

    const result = {
      departments: [],
      ministries: [],
      prayerTribes: [],
      subgroups: []
    };

    // Super admin can access all groups
    if (user.role === 'super-admin') {
      result.departments = await Department.find({ isActive: true });
      result.ministries = await Ministry.find({ isActive: true });
      result.prayerTribes = await PrayerTribe.find({ isActive: true });
      result.subgroups = await Subgroup.find({ isActive: true });
    } else {
      // Role-based access
      switch (user.role) {
        case 'senior-pastor':
        case 'associate-pastor':
          result.departments = await Department.find({ isActive: true });
          result.ministries = await Ministry.find({ isActive: true });
          result.prayerTribes = await PrayerTribe.find({ isActive: true });
          result.subgroups = await Subgroup.find({ isActive: true });
          break;

        case 'pastor':
        case 'department-leader':
          // Can access their own departments and related groups
          if (user.departmentIds.length > 0) {
            result.departments = await Department.find({ 
              _id: { $in: user.departmentIds }, 
              isActive: true 
            });
            result.ministries = await Ministry.find({ 
              departmentId: { $in: user.departmentIds }, 
              isActive: true 
            });
            result.subgroups = await Subgroup.find({ 
              parentType: 'department',
              parentId: { $in: user.departmentIds },
              isActive: true 
            });
          }
          if (user.ministryId) {
            const ministry = await Ministry.findById(user.ministryId);
            if (ministry) result.ministries.push(ministry);
            const ministrySubgroups = await Subgroup.findByParent('ministry', user.ministryId);
            result.subgroups.push(...ministrySubgroups);
          }
          if (user.prayerTribeId) {
            const tribe = await PrayerTribe.findById(user.prayerTribeId);
            if (tribe) result.prayerTribes.push(tribe);
            const tribeSubgroups = await Subgroup.findByParent('prayer-tribe', user.prayerTribeId);
            result.subgroups.push(...tribeSubgroups);
          }
          break;

        case 'clocker':
          // Can access groups in their clocker scopes
          user.clockerScopes.forEach(async (scope) => {
            switch (scope.type) {
              case 'department':
                const dept = await Department.findById(scope.targetId);
                if (dept) result.departments.push(dept);
                break;
              case 'ministry':
                const ministry = await Ministry.findById(scope.targetId);
                if (ministry) result.ministries.push(ministry);
                break;
              case 'prayer-tribe':
                const tribe = await PrayerTribe.findById(scope.targetId);
                if (tribe) result.prayerTribes.push(tribe);
                break;
              case 'subgroup':
                const subgroup = await Subgroup.findById(scope.targetId);
                if (subgroup) result.subgroups.push(subgroup);
                break;
            }
          });
          break;

        default:
          // Members can only access their own groups
          if (user.departmentIds.length > 0) {
            result.departments = await Department.find({ 
              _id: { $in: user.departmentIds }, 
              isActive: true 
            });
          }
          if (user.ministryId) {
            const ministry = await Ministry.findById(user.ministryId);
            if (ministry) result.ministries.push(ministry);
          }
          if (user.prayerTribeId) {
            const tribe = await PrayerTribe.findById(user.prayerTribeId);
            if (tribe) result.prayerTribes.push(tribe);
          }
          break;
      }
    }

    return result;
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
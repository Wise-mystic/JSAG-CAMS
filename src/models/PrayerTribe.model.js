const mongoose = require('mongoose');
const { DAYS_OF_WEEK } = require('../utils/constants');

// Prayer Tribe Schema
const prayerTribeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Prayer tribe name is required'],
    unique: true,
    trim: true,
    minlength: [2, 'Prayer tribe name must be at least 2 characters'],
    maxlength: [100, 'Prayer tribe name must not exceed 100 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must not exceed 500 characters'],
  },
  
  dayOfWeek: {
    type: String,
    enum: Object.values(DAYS_OF_WEEK),
    required: [true, 'Day of week is required'],
  },
  
  leaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  
  assistantLeaderIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  
  meetingTime: {
    type: String,
    required: [true, 'Meeting time is required'],
  },
  
  location: {
    name: String,
    address: String,
    room: String,
    virtualLink: String, // For online prayer meetings
  },
  
  isActive: {
    type: Boolean,
    default: true,
  },
  
  settings: {
    maxMembers: {
      type: Number,
      default: null, // null means no limit
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    allowVirtualAttendance: {
      type: Boolean,
      default: true,
    },
    reminderTime: {
      type: Number,
      default: 60, // Minutes before meeting
    },
    duration: {
      type: Number,
      default: 60, // Meeting duration in minutes
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
    memberCount: {
      type: Number,
      default: 0,
    },
    lastMeetingDate: {
      type: Date,
      default: null,
    },
    averageAttendance: {
      type: Number,
      default: 0,
    },
  },
  
  prayerFocus: {
    weekly: [String], // Weekly prayer points
    monthly: String, // Monthly theme
    special: [String], // Special prayer requests
  },
  
  contactInfo: {
    email: {
      type: String,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    phone: String,
    whatsappGroup: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
prayerTribeSchema.index({ name: 1 });
prayerTribeSchema.index({ dayOfWeek: 1 });
prayerTribeSchema.index({ leaderId: 1 });
prayerTribeSchema.index({ isActive: 1 });

// Virtual for members
prayerTribeSchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'prayerTribes',
});

// Pre-save middleware
prayerTribeSchema.pre('save', async function(next) {
  try {
    // Validate meeting time format (HH:MM)
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(this.meetingTime)) {
      throw new Error('Meeting time must be in HH:MM format');
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
prayerTribeSchema.methods = {
  // Check if a user can be added to this prayer tribe
  async canAddMember(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if user is already in this prayer tribe
    if (user.prayerTribes.some(tribeId => tribeId.equals(this._id))) {
      return { canAdd: false, reason: 'User is already in this prayer tribe' };
    }
    
    // Check maximum members limit
    if (this.settings.maxMembers && this.metadata.memberCount >= this.settings.maxMembers) {
      return { canAdd: false, reason: 'Prayer tribe has reached maximum capacity' };
    }
    
    // Check if user already has a prayer tribe for this day
    const existingTribes = await mongoose.model('PrayerTribe').find({
      _id: { $in: user.prayerTribes },
      dayOfWeek: this.dayOfWeek,
      isActive: true,
    });
    
    if (existingTribes.length > 0) {
      return { 
        canAdd: false, 
        reason: `User is already assigned to ${existingTribes[0].name} for ${this.dayOfWeek}` 
      };
    }
    
    return { canAdd: true };
  },
  
  // Add member to prayer tribe
  async addMember(userId, addedBy) {
    const result = await this.canAddMember(userId);
    
    if (!result.canAdd) {
      throw new Error(result.reason);
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    // Add prayer tribe to user
    user.prayerTribes.push(this._id);
    user.metadata.updatedBy = addedBy;
    await user.save();
    
    // Update member count
    this.metadata.memberCount++;
    await this.save();
    
    return user;
  },
  
  // Remove member from prayer tribe
  async removeMember(userId, removedBy) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if user is in this prayer tribe
    const tribeIndex = user.prayerTribes.findIndex(tribeId => tribeId.equals(this._id));
    if (tribeIndex === -1) {
      throw new Error('User is not a member of this prayer tribe');
    }
    
    // Remove prayer tribe from user
    user.prayerTribes.splice(tribeIndex, 1);
    user.metadata.updatedBy = removedBy;
    await user.save();
    
    // Update member count
    this.metadata.memberCount = Math.max(0, this.metadata.memberCount - 1);
    await this.save();
    
    return user;
  },
  
  // Update member count
  async updateMemberCount() {
    const User = mongoose.model('User');
    const count = await User.countDocuments({ 
      prayerTribes: this._id, 
      isActive: true 
    });
    
    this.metadata.memberCount = count;
    await this.save();
    
    return count;
  },
  
  // Check if user is a leader
  isLeader(userId) {
    return (
      (this.leaderId && this.leaderId.equals(userId)) ||
      this.assistantLeaderIds.some(id => id.equals(userId))
    );
  },
  
  // Get prayer tribe members
  async getMembers(options = {}) {
    const User = mongoose.model('User');
    const query = { prayerTribes: this._id, isActive: true };
    
    if (options.search) {
      query.$or = [
        { fullName: new RegExp(options.search, 'i') },
        { phoneNumber: new RegExp(options.search, 'i') },
        { email: new RegExp(options.search, 'i') },
      ];
    }
    
    let membersQuery = User.find(query)
      .select('fullName phoneNumber email role departmentId')
      .populate('departmentId', 'name');
    
    if (options.sort) {
      membersQuery = membersQuery.sort(options.sort);
    }
    
    if (options.limit) {
      membersQuery = membersQuery.limit(options.limit);
    }
    
    if (options.skip) {
      membersQuery = membersQuery.skip(options.skip);
    }
    
    return await membersQuery;
  },
  
  // Get next meeting date
  getNextMeetingDate() {
    const dayMap = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6,
    };
    
    const today = new Date();
    const currentDay = today.getDay();
    const targetDay = dayMap[this.dayOfWeek];
    
    let daysUntilNext = targetDay - currentDay;
    if (daysUntilNext <= 0) {
      daysUntilNext += 7; // Next week
    }
    
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysUntilNext);
    
    // Set meeting time
    const [hours, minutes] = this.meetingTime.split(':');
    nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    return nextDate;
  },
  
  // Update attendance statistics
  async updateAttendanceStats() {
    const Event = mongoose.model('Event');
    const Attendance = mongoose.model('Attendance');
    
    // Get prayer tribe events from last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const events = await Event.find({
      targetAudience: 'prayer-tribe',
      targetIds: this._id,
      startTime: { $gte: threeMonthsAgo },
      isClosed: true,
    });
    
    if (events.length === 0) {
      this.metadata.averageAttendance = 0;
      await this.save();
      return;
    }
    
    // Calculate average attendance
    let totalAttendance = 0;
    for (const event of events) {
      const attendanceCount = await Attendance.countDocuments({
        eventId: event._id,
        status: { $in: ['present', 'late'] },
      });
      totalAttendance += attendanceCount;
    }
    
    this.metadata.averageAttendance = Math.round(totalAttendance / events.length);
    this.metadata.lastMeetingDate = events[0].startTime;
    await this.save();
  },
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.__v;
    return obj;
  },
};

// Static methods
prayerTribeSchema.statics = {
  // Find active prayer tribes
  async findActive(filter = {}) {
    return await this.find({ ...filter, isActive: true })
      .populate('leaderId', 'fullName email phoneNumber')
      .populate('assistantLeaderIds', 'fullName email phoneNumber');
  },
  
  // Get prayer tribes by day
  async findByDay(dayOfWeek) {
    return await this.find({ dayOfWeek, isActive: true })
      .sort('meetingTime');
  },
  
  // Search prayer tribes
  async searchPrayerTribes(query) {
    return await this.find({
      $or: [
        { name: new RegExp(query, 'i') },
        { description: new RegExp(query, 'i') },
      ],
      isActive: true,
    });
  },
  
  // Get prayer tribe with full details
  async getWithDetails(prayerTribeId) {
    return await this.findById(prayerTribeId)
      .populate('leaderId', 'fullName email phoneNumber role')
      .populate('assistantLeaderIds', 'fullName email phoneNumber role');
  },
  
  // Get prayer schedule for the week
  async getWeeklySchedule() {
    const schedule = {};
    const days = Object.values(DAYS_OF_WEEK);
    
    for (const day of days) {
      schedule[day] = await this.find({ 
        dayOfWeek: day, 
        isActive: true 
      })
      .select('name meetingTime location')
      .sort('meetingTime');
    }
    
    return schedule;
  },
  
  // Get prayer tribe statistics
  async getPrayerTribeStatistics(prayerTribeId) {
    const prayerTribe = await this.findById(prayerTribeId);
    if (!prayerTribe) {
      throw new Error('Prayer tribe not found');
    }
    
    const User = mongoose.model('User');
    const Event = mongoose.model('Event');
    
    // Get member statistics
    const members = await User.find({ 
      prayerTribes: prayerTribeId, 
      isActive: true 
    });
    
    // Get department distribution
    const departmentDistribution = {};
    members.forEach(member => {
      const deptId = member.departmentId ? member.departmentId.toString() : 'None';
      departmentDistribution[deptId] = (departmentDistribution[deptId] || 0) + 1;
    });
    
    // Get recent events
    const recentEvents = await Event.find({
      targetAudience: 'prayer-tribe',
      targetIds: prayerTribeId,
      startTime: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }).sort('-startTime').limit(10);
    
    return {
      prayerTribeId,
      name: prayerTribe.name,
      dayOfWeek: prayerTribe.dayOfWeek,
      memberCount: members.length,
      averageAttendance: prayerTribe.metadata.averageAttendance,
      departmentDistribution,
      leaders: {
        main: prayerTribe.leaderId,
        assistants: prayerTribe.assistantLeaderIds,
      },
      recentEvents: recentEvents.length,
      nextMeeting: prayerTribe.getNextMeetingDate(),
    };
  },
};

// Create and export the model
const PrayerTribe = mongoose.model('PrayerTribe', prayerTribeSchema);

module.exports = PrayerTribe; 
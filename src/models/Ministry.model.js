const mongoose = require('mongoose');

// Ministry Schema
const ministrySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Ministry name is required'],
    unique: true,
    trim: true,
    minlength: [2, 'Ministry name must be at least 2 characters'],
    maxlength: [100, 'Ministry name must not exceed 100 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must not exceed 500 characters'],
  },
  
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department ID is required'],
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
  
  allowsMultipleMembership: {
    type: Boolean,
    default: false, // Enforces one-ministry-per-member rule
  },
  
  requiresApproval: {
    type: Boolean,
    default: false,
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
    ageRestrictions: {
      minAge: {
        type: Number,
        default: null,
      },
      maxAge: {
        type: Number,
        default: null,
      },
    },
    meetingSchedule: {
      dayOfWeek: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      },
      time: String,
      frequency: {
        type: String,
        enum: ['weekly', 'bi-weekly', 'monthly'],
        default: 'weekly',
      },
      location: String,
    },
    requirements: [String], // List of requirements to join
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
    lastActivityDate: {
      type: Date,
      default: Date.now,
    },
  },
  
  contactInfo: {
    email: {
      type: String,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    phone: String,
    socialMedia: {
      facebook: String,
      instagram: String,
      twitter: String,
      whatsapp: String,
    },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
// name index removed - field already has unique: true
ministrySchema.index({ departmentId: 1 });
ministrySchema.index({ leaderId: 1 });
ministrySchema.index({ isActive: 1 });

// Virtual for member count
ministrySchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'ministryId',
  count: true,
});

// Pre-save middleware
ministrySchema.pre('save', async function(next) {
  try {
    // Validate department exists
    if (this.departmentId) {
      const Department = mongoose.model('Department');
      const dept = await Department.findById(this.departmentId);
      
      if (!dept) {
        throw new Error('Department not found');
      }
      
      if (!dept.isActive) {
        throw new Error('Cannot assign ministry to inactive department');
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
ministrySchema.methods = {
  // Check if a user can be added to this ministry
  async canAddMember(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if user is already in this ministry
    if (user.ministryId && user.ministryId.equals(this._id)) {
      return { canAdd: false, reason: 'User is already in this ministry' };
    }
    
    // Check one-ministry-per-member rule
    if (!this.allowsMultipleMembership && user.ministryId) {
      const currentMinistry = await mongoose.model('Ministry').findById(user.ministryId);
      return { 
        canAdd: false, 
        reason: `User is already in ${currentMinistry.name} ministry. Only one ministry membership is allowed.` 
      };
    }
    
    // Check maximum members limit
    if (this.settings.maxMembers && this.metadata.memberCount >= this.settings.maxMembers) {
      return { canAdd: false, reason: 'Ministry has reached maximum capacity' };
    }
    
    // Check if user belongs to the same department
    if (!user.departmentId || !user.departmentId.equals(this.departmentId)) {
      return { canAdd: false, reason: 'User must be in the same department as the ministry' };
    }
    
    // Check age restrictions (if we have user's age)
    // This would require adding birthDate to User model
    
    return { canAdd: true };
  },
  
  // Add member to ministry
  async addMember(userId, approvedBy) {
    const result = await this.canAddMember(userId);
    
    if (!result.canAdd) {
      throw new Error(result.reason);
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    // Remove from previous ministry if exists
    if (user.ministryId && !this.allowsMultipleMembership) {
      const previousMinistry = await mongoose.model('Ministry').findById(user.ministryId);
      if (previousMinistry) {
        previousMinistry.metadata.memberCount--;
        await previousMinistry.save();
      }
    }
    
    // Add to new ministry
    user.ministryId = this._id;
    user.metadata.updatedBy = approvedBy;
    await user.save();
    
    // Update member count
    this.metadata.memberCount++;
    this.metadata.lastActivityDate = new Date();
    await this.save();
    
    return user;
  },
  
  // Remove member from ministry
  async removeMember(userId, removedBy) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user || !user.ministryId || !user.ministryId.equals(this._id)) {
      throw new Error('User is not a member of this ministry');
    }
    
    user.ministryId = null;
    user.metadata.updatedBy = removedBy;
    await user.save();
    
    // Update member count
    this.metadata.memberCount = Math.max(0, this.metadata.memberCount - 1);
    this.metadata.lastActivityDate = new Date();
    await this.save();
    
    return user;
  },
  
  // Update member count
  async updateMemberCount() {
    const User = mongoose.model('User');
    const count = await User.countDocuments({ 
      ministryId: this._id, 
      isActive: true 
    });
    
    this.metadata.memberCount = count;
    this.metadata.lastActivityDate = new Date();
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
  
  // Get ministry members
  async getMembers(options = {}) {
    const User = mongoose.model('User');
    const query = { ministryId: this._id, isActive: true };
    
    if (options.search) {
      query.$or = [
        { fullName: new RegExp(options.search, 'i') },
        { phoneNumber: new RegExp(options.search, 'i') },
        { email: new RegExp(options.search, 'i') },
      ];
    }
    
    let membersQuery = User.find(query)
      .select('fullName phoneNumber email role joinDate');
    
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
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.__v;
    return obj;
  },
};

// Static methods
ministrySchema.statics = {
  // Find active ministries
  async findActive(filter = {}) {
    return await this.find({ ...filter, isActive: true })
      .populate('departmentId', 'name')
      .populate('leaderId', 'fullName email phoneNumber')
      .populate('assistantLeaderIds', 'fullName email phoneNumber');
  },
  
  // Get ministries by department
  async findByDepartment(departmentId) {
    return await this.find({ departmentId, isActive: true });
  },
  
  // Search ministries
  async searchMinistries(query) {
    return await this.find({
      $or: [
        { name: new RegExp(query, 'i') },
        { description: new RegExp(query, 'i') },
      ],
      isActive: true,
    }).populate('departmentId', 'name');
  },
  
  // Get ministry with full details
  async getWithDetails(ministryId) {
    return await this.findById(ministryId)
      .populate('departmentId', 'name category')
      .populate('leaderId', 'fullName email phoneNumber role')
      .populate('assistantLeaderIds', 'fullName email phoneNumber role');
  },
  
  // Transfer member between ministries
  async transferMember(userId, fromMinistryId, toMinistryId, transferredBy) {
    const fromMinistry = fromMinistryId ? await this.findById(fromMinistryId) : null;
    const toMinistry = await this.findById(toMinistryId);
    
    if (!toMinistry) {
      throw new Error('Target ministry not found');
    }
    
    // Add to new ministry (will handle removal from old ministry)
    return await toMinistry.addMember(userId, transferredBy);
  },
  
  // Get ministry statistics
  async getMinistryStatistics(ministryId) {
    const ministry = await this.findById(ministryId);
    if (!ministry) {
      throw new Error('Ministry not found');
    }
    
    const User = mongoose.model('User');
    const Event = mongoose.model('Event');
    const Attendance = mongoose.model('Attendance');
    
    // Get member statistics
    const members = await User.find({ ministryId, isActive: true });
    const memberIds = members.map(m => m._id);
    
    // Get event statistics
    const events = await Event.find({ 
      ministryId,
      startTime: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
    });
    
    // Get attendance statistics
    const attendanceStats = await Attendance.aggregate([
      {
        $match: {
          userId: { $in: memberIds },
          createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    return {
      ministryId,
      name: ministry.name,
      memberCount: members.length,
      eventCount: events.length,
      attendance: attendanceStats,
      leaders: {
        main: ministry.leaderId,
        assistants: ministry.assistantLeaderIds
      }
    };
  },
};

// Create and export the model
const Ministry = mongoose.model('Ministry', ministrySchema);

module.exports = Ministry; 
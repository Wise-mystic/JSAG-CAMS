const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../utils/constants');

// Subgroup Schema
const subgroupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Subgroup name is required'],
    trim: true,
    minlength: [2, 'Subgroup name must be at least 2 characters'],
    maxlength: [100, 'Subgroup name must not exceed 100 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must not exceed 500 characters'],
  },
  
  // Parent group information
  parentType: {
    type: String,
    enum: ['department', 'ministry', 'prayer-tribe'],
    required: [true, 'Parent type is required'],
  },
  
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Parent ID is required'],
    refPath: 'parentType',
  },
  
  // Leadership
  leaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  
  assistantLeaderIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  
  // Settings and configuration
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
    isPublic: {
      type: Boolean,
      default: true, // Whether the subgroup is visible to all members of the parent group
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
        enum: ['weekly', 'bi-weekly', 'monthly', 'irregular'],
        default: 'weekly',
      },
      location: String,
    },
    specialRequirements: [String], // List of requirements to join
  },
  
  // Metadata
  metadata: {
    memberCount: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
subgroupSchema.index({ parentType: 1, parentId: 1 });
subgroupSchema.index({ name: 1, parentType: 1, parentId: 1 }, { unique: true });
subgroupSchema.index({ leaderId: 1 });
subgroupSchema.index({ isActive: 1 });

// Virtual for members
subgroupSchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'subgroups',
});

// Virtual for parent group
subgroupSchema.virtual('parent', {
  refPath: 'parentType',
  localField: 'parentId',
  foreignField: '_id',
  justOne: true,
});

// Instance methods
subgroupSchema.methods = {
  // Update member count
  async updateMemberCount() {
    const User = mongoose.model('User');
    const count = await User.countDocuments({ 
      subgroups: this._id, 
      isActive: true 
    });
    this.metadata.memberCount = count;
    await this.save();
    return count;
  },
  
  // Check if user can join this subgroup
  async canUserJoin(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user || !user.isActive) return false;
    
    // Check if user is already a member
    if (user.subgroups.includes(this._id)) return false;
    
    // Check if user belongs to the parent group
    switch (this.parentType) {
      case 'department':
        if (!user.departmentIds.includes(this.parentId)) return false;
        break;
      case 'ministry':
        if (!user.ministryId || !user.ministryId.equals(this.parentId)) return false;
        break;
      case 'prayer-tribe':
        if (!user.prayerTribeId || !user.prayerTribeId.equals(this.parentId)) return false;
        break;
      default:
        return false;
    }
    
    // Check age restrictions
    if (this.settings.ageRestrictions.minAge || this.settings.ageRestrictions.maxAge) {
      // Age calculation logic would go here if birthdate is available
      // For now, skip this check
    }
    
    // Check capacity
    if (this.settings.maxMembers && this.metadata.memberCount >= this.settings.maxMembers) {
      return false;
    }
    
    return true;
  },
  
  // Add member to subgroup
  async addMember(userId, addedBy = null) {
    const canJoin = await this.canUserJoin(userId);
    if (!canJoin) {
      throw new Error('User cannot join this subgroup');
    }
    
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user.subgroups.includes(this._id)) {
      user.subgroups.push(this._id);
      await user.save();
      await this.updateMemberCount();
      
      // Log the action if needed
      const AuditLog = mongoose.model('AuditLog');
      await AuditLog.logAction({
        userId: addedBy || userId,
        action: AUDIT_ACTIONS.SUBGROUP_MEMBER_ADD,
        resource: 'subgroup',
        resourceId: this._id,
        details: { memberId: userId },
        result: { success: true }
      });
    }
    
    return true;
  },
  
  // Remove member from subgroup
  async removeMember(userId, removedBy = null) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (user && user.subgroups.includes(this._id)) {
      user.subgroups.pull(this._id);
      await user.save();
      await this.updateMemberCount();
      
      // Log the action if needed
      const AuditLog = mongoose.model('AuditLog');
      await AuditLog.logAction({
        userId: removedBy || userId,
        action: AUDIT_ACTIONS.SUBGROUP_MEMBER_REMOVE,
        resource: 'subgroup',
        resourceId: this._id,
        details: { memberId: userId },
        result: { success: true }
      });
    }
    
    return true;
  },
  
  // Get subgroup members
  async getMembers(includeInactive = false) {
    const User = mongoose.model('User');
    const filter = { 
      subgroups: this._id,
      ...(includeInactive ? {} : { isActive: true })
    };
    
    return await User.find(filter)
      .populate('departmentIds ministryId prayerTribeId')
      .sort('fullName');
  },
  
  // Get subgroup statistics
  async getStatistics() {
    const members = await this.getMembers();
    const User = mongoose.model('User');
    
    // Get role distribution
    const roleDistribution = {};
    members.forEach(member => {
      roleDistribution[member.role] = (roleDistribution[member.role] || 0) + 1;
    });
    
    return {
      subgroupId: this._id,
      name: this.name,
      parentType: this.parentType,
      memberCount: members.length,
      isActive: this.isActive,
      roleDistribution,
      leadership: {
        leader: this.leaderId,
        assistants: this.assistantLeaderIds,
      },
      settings: this.settings,
      lastActivity: this.metadata.lastActivity,
    };
  },
};

// Static methods
subgroupSchema.statics = {
  // Find subgroups by parent
  async findByParent(parentType, parentId) {
    return await this.find({ 
      parentType, 
      parentId, 
      isActive: true 
    }).populate('leaderId assistantLeaderIds');
  },
  
  // Find user's subgroups
  async findUserSubgroups(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    if (!user) return [];
    
    return await this.find({ 
      _id: { $in: user.subgroups },
      isActive: true 
    }).populate('leaderId assistantLeaderIds');
  },
  
  // Search subgroups
  async searchSubgroups(query, parentType = null, parentId = null) {
    const filter = {
      $or: [
        { name: new RegExp(query, 'i') },
        { description: new RegExp(query, 'i') },
      ],
      isActive: true,
    };
    
    if (parentType) filter.parentType = parentType;
    if (parentId) filter.parentId = parentId;
    
    return await this.find(filter)
      .populate('leaderId assistantLeaderIds')
      .limit(20);
  },
};

// Pre-save middleware
subgroupSchema.pre('save', function(next) {
  this.metadata.updatedBy = this.metadata.updatedBy || this.metadata.createdBy;
  this.metadata.lastActivity = new Date();
  next();
});

// Post-save middleware to update member count
subgroupSchema.post('save', async function(doc) {
  if (doc.isNew) {
    await doc.updateMemberCount();
  }
});

const Subgroup = mongoose.model('Subgroup', subgroupSchema);

module.exports = Subgroup; 
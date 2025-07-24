const mongoose = require('mongoose');
const { DEPARTMENT_CATEGORIES } = require('../utils/constants');

// Department Schema
const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Department name is required'],
    unique: true,
    trim: true,
    minlength: [2, 'Department name must be at least 2 characters'],
    maxlength: [100, 'Department name must not exceed 100 characters'],
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must not exceed 500 characters'],
  },
  
  category: {
    type: String,
    enum: Object.values(DEPARTMENT_CATEGORIES),
    required: [true, 'Department category is required'],
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
  
  parentDepartmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  
  allowsOverlap: {
    type: Boolean,
    default: true,
  },
  
  mutuallyExclusiveWith: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  
  isActive: {
    type: Boolean,
    default: true,
  },
  
  settings: {
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    maxMembers: {
      type: Number,
      default: null, // null means no limit
    },
    allowSubgroups: {
      type: Boolean,
      default: true,
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
    location: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
// name index removed - field already has unique: true
departmentSchema.index({ category: 1 });
departmentSchema.index({ leaderId: 1 });
departmentSchema.index({ isActive: 1 });
departmentSchema.index({ parentDepartmentId: 1 });

// Virtual for member count
departmentSchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'departmentIds',
  count: true,
});

// Virtual for subdepartments
departmentSchema.virtual('subdepartments', {
  ref: 'Department',
  localField: '_id',
  foreignField: 'parentDepartmentId',
});

// Virtual for ministries
departmentSchema.virtual('ministries', {
  ref: 'Ministry',
  localField: '_id',
  foreignField: 'departmentId',
});

// Pre-save middleware
departmentSchema.pre('save', async function(next) {
  try {
    // Check for circular parent reference
    if (this.parentDepartmentId && this.parentDepartmentId.equals(this._id)) {
      throw new Error('Department cannot be its own parent');
    }
    
    // Validate mutual exclusivity
    if (this.mutuallyExclusiveWith && this.mutuallyExclusiveWith.length > 0) {
      // Ensure department is not in its own exclusion list
      this.mutuallyExclusiveWith = this.mutuallyExclusiveWith.filter(
        deptId => !deptId.equals(this._id)
      );
    }
    
    // Set default mutual exclusivity for Music and Ushering departments
    if (this.name.toLowerCase() === 'music' || this.name.toLowerCase() === 'ushering') {
      const Department = mongoose.model('Department');
      const otherDeptName = this.name.toLowerCase() === 'music' ? 'ushering' : 'music';
      const otherDept = await Department.findOne({ 
        name: new RegExp(`^${otherDeptName}$`, 'i') 
      });
      
      if (otherDept && !this.mutuallyExclusiveWith.some(id => id.equals(otherDept._id))) {
        this.mutuallyExclusiveWith.push(otherDept._id);
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
departmentSchema.methods = {
  // Check if a user can be added to this department
  async canAddMember(userId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if user is already in this department
    if (user.departmentIds && user.departmentIds.some(id => id.equals(this._id))) {
      return { canAdd: false, reason: 'User is already in this department' };
    }
    
    // Check maximum members limit
    if (this.settings.maxMembers) {
      const currentMemberCount = await User.countDocuments({
        departmentIds: this._id,
        isActive: true
      });
      
      if (currentMemberCount >= this.settings.maxMembers) {
        return { canAdd: false, reason: 'Department has reached maximum member limit' };
      }
    }
    
    // Check mutual exclusivity rules
    if (this.mutuallyExclusiveWith && this.mutuallyExclusiveWith.length > 0) {
      const userDepartments = user.departmentIds || [];
      const hasExclusiveDept = userDepartments.some(deptId => 
        this.mutuallyExclusiveWith.some(exclusiveDeptId => exclusiveDeptId.equals(deptId))
      );
      
      if (hasExclusiveDept) {
        return { 
          canAdd: false, 
          reason: 'User is in a mutually exclusive department' 
        };
      }
    }
    
    return { canAdd: true };
  },
  
  // Get department hierarchy path
  async getHierarchyPath() {
    const path = [this];
    let currentDept = this;
    
    while (currentDept.parentDepartmentId) {
      const parent = await mongoose.model('Department').findById(currentDept.parentDepartmentId);
      if (!parent) break;
      path.unshift(parent);
      currentDept = parent;
    }
    
    return path;
  },
  
  // Get all subdepartments recursively
  async getAllSubdepartments() {
    const Department = mongoose.model('Department');
    const subdepts = [];
    
    const getSubdepts = async (parentId) => {
      const children = await Department.find({ 
        parentDepartmentId: parentId, 
        isActive: true 
      });
      
      for (const child of children) {
        subdepts.push(child);
        await getSubdepts(child._id);
      }
    };
    
    await getSubdepts(this._id);
    return subdepts;
  },
  
  // Update member count
  async updateMemberCount() {
    const User = mongoose.model('User');
    const count = await User.countDocuments({ 
      departmentIds: this._id,
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
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.__v;
    return obj;
  },
};

// Static methods
departmentSchema.statics = {
  // Find active departments
  async findActive(filter = {}) {
    return this.find({ ...filter, isActive: true });
  },
  
  // Find departments by category
  async findByCategory(category) {
    return this.find({ category, isActive: true });
  },
  
  // Get root departments (no parent)
  async getRootDepartments() {
    return this.find({ 
      parentDepartmentId: null,
      isActive: true 
    });
  },
  
  // Search departments
  async searchDepartments(query) {
    return this.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    });
  },
  
  // Get department with full details
  async getWithDetails(departmentId) {
    return this.findById(departmentId)
      .populate('leaderId', 'fullName phoneNumber role')
      .populate('assistantLeaderIds', 'fullName phoneNumber role')
      .populate('parentDepartmentId', 'name category')
      .populate('mutuallyExclusiveWith', 'name category');
  },
  
  // Validate mutual exclusivity rules
  async validateMutualExclusivity(userId, newDepartmentId) {
    const User = mongoose.model('User');
    const user = await User.findById(userId).populate('departmentIds');
    
    if (!user || !user.departmentIds) {
      return { valid: true };
    }
    
    const newDept = await this.findById(newDepartmentId);
    if (!newDept) {
      return { valid: false, reason: 'Department not found' };
    }
    
    const result = await newDept.canAddMember(userId);
    return { valid: result.canAdd, reason: result.reason };
  },
};

// Create and export the model
const Department = mongoose.model('Department', departmentSchema);

module.exports = Department; 
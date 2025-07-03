const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const config = require('../config/environment');
const { USER_ROLES, VALIDATION } = require('../utils/constants');

// User Schema
const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [100, 'Full name must not exceed 100 characters'],
  },
  
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true, // Allow null/undefined but ensure uniqueness when present
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
  },
  
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(v) {
        return VALIDATION.PHONE_REGEX.test(v);
      },
      message: 'Please provide a valid phone number',
    },
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [VALIDATION.PASSWORD_MIN_LENGTH, `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`],
    select: false, // Don't include password in queries by default
  },
  
  role: {
    type: String,
    enum: Object.values(USER_ROLES),
    default: USER_ROLES.MEMBER,
    required: true,
  },
  
  departmentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  
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
  
  subgroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subgroup',
  }],
  
  clockerScopes: [{
    type: {
      type: String,
      enum: ['department', 'ministry', 'prayer-tribe', 'subgroup'],
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'clockerScopes.type',
    },
  }],
  
  isActive: {
    type: Boolean,
    default: true,
  },
  
  isVerified: {
    type: Boolean,
    default: false,
  },
  
  joinDate: {
    type: Date,
    default: Date.now,
  },
  
  lastLogin: {
    type: Date,
    default: null,
  },
  
  profilePicture: {
    type: String,
    default: null,
  },
  
  preferences: {
    notificationEnabled: {
      type: Boolean,
      default: true,
    },
    eventReminders: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
      default: 'en',
    },
  },
  
  spiritualInfo: {
    baptismDate: Date,
    salvationDate: Date,
    membershipClass: {
      completed: {
        type: Boolean,
        default: false,
      },
      completionDate: Date,
    },
  },
  
  contactInfo: {
    alternatePhone: String,
    address: String,
    city: String,
    state: String,
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String,
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
    passwordChangedAt: Date,
    resetPasswordToken: String,
    resetPasswordExpires: Date,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
userSchema.index({ phoneNumber: 1 });
userSchema.index({ email: 1 }, { sparse: true });
userSchema.index({ role: 1, departmentId: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ fullName: 'text' });

// Virtual for member count (for department leaders)
userSchema.virtual('departmentMemberCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'departmentId',
  count: true,
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash the password
    this.password = await bcrypt.hash(this.password, config.security.bcryptRounds);
    
    // Update passwordChangedAt
    this.metadata.passwordChangedAt = Date.now() - 1000; // Subtract 1 second to ensure token is created after password change
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
userSchema.methods = {
  // Compare password
  async comparePassword(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  },
  
  // Check if password changed after JWT was issued
  changedPasswordAfter(JWTTimestamp) {
    if (this.metadata.passwordChangedAt) {
      const changedTimestamp = parseInt(
        this.metadata.passwordChangedAt.getTime() / 1000,
        10
      );
      return JWTTimestamp < changedTimestamp;
    }
    return false;
  },
  
  // Generate password reset token
  createPasswordResetToken() {
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    this.metadata.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    this.metadata.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    return resetToken;
  },
  
  // Check if user has a specific role or higher
  hasRole(requiredRole) {
    const { ROLE_HIERARCHY } = require('../utils/constants');
    const userRoleLevel = ROLE_HIERARCHY[this.role];
    const requiredRoleLevel = ROLE_HIERARCHY[requiredRole];
    
    return userRoleLevel >= requiredRoleLevel;
  },
  
  // Check if user can manage another user
  canManage(targetUser) {
    const { ROLE_HIERARCHY } = require('../utils/constants');
    const userRoleLevel = ROLE_HIERARCHY[this.role];
    const targetRoleLevel = ROLE_HIERARCHY[targetUser.role];
    
    // Can only manage users with lower role levels
    return userRoleLevel > targetRoleLevel;
  },
  
  // Check if user is a clocker for a specific scope
  isClockerFor(scopeType, targetId) {
    return this.clockerScopes.some(scope => 
      scope.type === scopeType && 
      scope.targetId.toString() === targetId.toString()
    );
  },
  
  // Get user's accessible scopes
  getAccessibleScopes() {
    const scopes = {
      departments: [],
      ministries: [],
      prayerTribes: [],
      subgroups: [],
    };
    
    // Add direct assignments
    if (this.departmentId) scopes.departments.push(this.departmentId);
    if (this.ministryId) scopes.ministries.push(this.ministryId);
    scopes.prayerTribes = [...this.prayerTribes];
    scopes.subgroups = [...this.subgroups];
    
    // Add clocker scopes
    this.clockerScopes.forEach(scope => {
      switch (scope.type) {
        case 'department':
          if (!scopes.departments.includes(scope.targetId)) {
            scopes.departments.push(scope.targetId);
          }
          break;
        case 'ministry':
          if (!scopes.ministries.includes(scope.targetId)) {
            scopes.ministries.push(scope.targetId);
          }
          break;
        case 'prayer-tribe':
          if (!scopes.prayerTribes.includes(scope.targetId)) {
            scopes.prayerTribes.push(scope.targetId);
          }
          break;
        case 'subgroup':
          if (!scopes.subgroups.includes(scope.targetId)) {
            scopes.subgroups.push(scope.targetId);
          }
          break;
      }
    });
    
    return scopes;
  },
  
  // Convert to safe JSON (remove sensitive fields)
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.password;
    delete obj.metadata.resetPasswordToken;
    delete obj.metadata.resetPasswordExpires;
    delete obj.__v;
    return obj;
  },
};

// Static methods
userSchema.statics = {
  // Find user by phone number
  async findByPhoneNumber(phoneNumber) {
    return await this.findOne({ phoneNumber });
  },
  
  // Find active users
  async findActive(filter = {}) {
    return await this.find({ ...filter, isActive: true });
  },
  
  // Get users by role
  async findByRole(role) {
    return await this.find({ role, isActive: true });
  },
  
  // Get department members
  async getDepartmentMembers(departmentId) {
    return await this.find({ 
      departmentId, 
      isActive: true 
    }).populate('ministryId prayerTribes subgroups');
  },
  
  // Search users
  async searchUsers(query, limit = 20) {
    return await this.find({
      $or: [
        { fullName: new RegExp(query, 'i') },
        { phoneNumber: new RegExp(query, 'i') },
        { email: new RegExp(query, 'i') },
      ],
      isActive: true,
    }).limit(limit);
  },
};

// Add crypto import at the top if using password reset
const crypto = require('crypto');

// Create and export the model
const User = mongoose.model('User', userSchema);

module.exports = User; 
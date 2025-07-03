// User Service
// Handles user CRUD, role assignment, import/export, and attendance history logic

const User = require('../models/User.model');
const Department = require('../models/Department.model');
const Ministry = require('../models/Ministry.model');
const PrayerTribe = require('../models/PrayerTribe.model');
const Attendance = require('../models/Attendance.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
const { 
  USER_ROLES, 
  ROLE_HIERARCHY, 
  ERROR_CODES, 
  AUDIT_ACTIONS,
  SUCCESS_MESSAGES 
} = require('../utils/constants');
const mongoose = require('mongoose');

class UserService {
  /**
   * Get all users with filtering, sorting, and pagination
   */
  async getAllUsers(filters = {}, options = {}) {
    const {
      page = 1,
      limit = 50,
      sort = '-createdAt',
      search,
      role,
      department,
      isActive,
      isVerified
    } = options;

    const query = {};

    // Apply filters
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) query.role = role;
    if (department) query.departmentId = department;
    if (typeof isActive === 'boolean') query.isActive = isActive;
    if (typeof isVerified === 'boolean') query.isVerified = isVerified;

    // Role-based filtering for scoped access
    if (filters.scopedAccess && filters.currentUserRole !== USER_ROLES.SUPER_ADMIN) {
      if (filters.currentUserRole === USER_ROLES.DEPARTMENT_LEADER && filters.departmentId) {
        query.departmentId = filters.departmentId;
      }
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .populate('departmentId', 'name category')
        .populate('ministryId', 'name')
        .populate('prayerTribes', 'name dayOfWeek')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-password'),
      User.countDocuments(query)
    ]);

    return {
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get user by ID with populated relationships
   */
  async getUserById(userId, requestingUserId, requestingUserRole) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw ApiError.badRequest('Invalid user ID', ERROR_CODES.INVALID_INPUT);
    }

    const user = await User.findById(userId)
      .populate('departmentId', 'name category leaderId')
      .populate('ministryId', 'name leaderId')
      .populate('prayerTribes', 'name dayOfWeek leaderId')
      .populate('clockerScopes.targetId')
      .select('-password');

    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check if requesting user can view this user
    if (!this.canAccessUser(requestingUserId, requestingUserRole, user)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    return user;
  }

  /**
   * Create new user
   */
  async createUser(userData, createdBy, createdByRole, ipAddress) {
    const {
      fullName,
      phoneNumber,
      email,
      password,
      role = USER_ROLES.MEMBER,
      departmentId,
      ministryId,
      prayerTribes = [],
      clockerScopes = []
    } = userData;

    // Validate role assignment permissions
    if (!this.canAssignRole(createdByRole, role)) {
      throw ApiError.forbidden(
        'Insufficient permissions to assign this role',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Check if phone number already exists
    const existingUser = await User.findByPhoneNumber(phoneNumber);
    if (existingUser) {
      throw ApiError.conflict('Phone number already registered', ERROR_CODES.DUPLICATE_ENTRY);
    }

    // Check email if provided
    if (email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        throw ApiError.conflict('Email already registered', ERROR_CODES.DUPLICATE_ENTRY);
      }
    }

    // Validate department assignment
    if (departmentId) {
      const department = await Department.findById(departmentId);
      if (!department) {
        throw ApiError.badRequest('Invalid department', ERROR_CODES.INVALID_INPUT);
      }
    }

    // Validate ministry assignment (only one ministry per member)
    if (ministryId) {
      const ministry = await Ministry.findById(ministryId);
      if (!ministry) {
        throw ApiError.badRequest('Invalid ministry', ERROR_CODES.INVALID_INPUT);
      }
    }

    // Create user
    const user = new User({
      fullName,
      phoneNumber,
      email,
      password,
      role,
      departmentId,
      ministryId,
      prayerTribes,
      clockerScopes,
      isActive: true,
      isVerified: true, // Admin-created users are auto-verified
      createdBy
    });

    await user.save();

    // Log user creation
    await AuditLog.logAction({
      userId: createdBy,
      action: AUDIT_ACTIONS.USER_CREATE,
      resource: 'user',
      resourceId: user._id,
      details: {
        targetUserId: user._id,
        assignedRole: role,
        phoneNumber,
        departmentId,
        ministryId
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getUserById(user._id, createdBy, createdByRole);
  }

  /**
   * Update user information
   */
  async updateUser(userId, updateData, updatedBy, updatedByRole, ipAddress) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyUser(updatedBy, updatedByRole, user)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    const {
      fullName,
      email,
      departmentId,
      ministryId,
      prayerTribes,
      clockerScopes,
      isActive
    } = updateData;

    const updatePayload = {};
    const changes = {};

    // Update basic info
    if (fullName && fullName !== user.fullName) {
      updatePayload.fullName = fullName;
      changes.fullName = { from: user.fullName, to: fullName };
    }

    if (email !== undefined && email !== user.email) {
      // Check email uniqueness if changing
      if (email) {
        const emailExists = await User.findOne({ email, _id: { $ne: userId } });
        if (emailExists) {
          throw ApiError.conflict('Email already in use', ERROR_CODES.DUPLICATE_ENTRY);
        }
      }
      updatePayload.email = email;
      changes.email = { from: user.email, to: email };
    }

    // Update department
    if (departmentId !== undefined && departmentId?.toString() !== user.departmentId?.toString()) {
      if (departmentId) {
        const department = await Department.findById(departmentId);
        if (!department) {
          throw ApiError.badRequest('Invalid department', ERROR_CODES.INVALID_INPUT);
        }
      }
      updatePayload.departmentId = departmentId;
      changes.departmentId = { from: user.departmentId, to: departmentId };
    }

    // Update ministry (enforce one ministry rule)
    if (ministryId !== undefined && ministryId?.toString() !== user.ministryId?.toString()) {
      if (ministryId) {
        const ministry = await Ministry.findById(ministryId);
        if (!ministry) {
          throw ApiError.badRequest('Invalid ministry', ERROR_CODES.INVALID_INPUT);
        }
      }
      updatePayload.ministryId = ministryId;
      changes.ministryId = { from: user.ministryId, to: ministryId };
    }

    // Update prayer tribes
    if (prayerTribes !== undefined) {
      updatePayload.prayerTribes = prayerTribes;
      changes.prayerTribes = { from: user.prayerTribes, to: prayerTribes };
    }

    // Update clocker scopes
    if (clockerScopes !== undefined) {
      updatePayload.clockerScopes = clockerScopes;
      changes.clockerScopes = { from: user.clockerScopes, to: clockerScopes };
    }

    // Update active status
    if (typeof isActive === 'boolean' && isActive !== user.isActive) {
      updatePayload.isActive = isActive;
      changes.isActive = { from: user.isActive, to: isActive };
    }

    if (Object.keys(updatePayload).length === 0) {
      throw ApiError.badRequest('No valid updates provided', ERROR_CODES.INVALID_INPUT);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { ...updatePayload, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('departmentId ministryId prayerTribes');

    // Log user update
    await AuditLog.logAction({
      userId: updatedBy,
      action: AUDIT_ACTIONS.USER_UPDATE,
      resource: 'user',
      resourceId: userId,
      details: {
        changes,
        targetUserId: userId
      },
      ipAddress,
      result: { success: true }
    });

    return updatedUser;
  }

  /**
   * Assign role to user
   */
  async assignRole(userId, newRole, assignedBy, assignedByRole, ipAddress) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check if assigner can assign this role
    if (!this.canAssignRole(assignedByRole, newRole)) {
      throw ApiError.forbidden(
        'Insufficient permissions to assign this role',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    const oldRole = user.role;
    if (oldRole === newRole) {
      throw ApiError.badRequest('User already has this role', ERROR_CODES.INVALID_INPUT);
    }

    // Update user role
    user.role = newRole;
    await user.save();

    // Log role assignment
    await AuditLog.logAction({
      userId: assignedBy,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
      resource: 'user',
      resourceId: userId,
      details: {
        targetUserId: userId,
        oldRole,
        newRole,
        assignedBy
      },
      ipAddress,
      result: { success: true }
    });

    return user;
  }

  /**
   * Get user's attendance history
   */
  async getUserAttendanceHistory(userId, options = {}) {
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      eventType
    } = options;

    const query = { userId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const attendanceQuery = Attendance.find(query)
      .populate({
        path: 'eventId',
        select: 'title eventType startTime endTime departmentId',
        populate: {
          path: 'departmentId',
          select: 'name'
        }
      })
      .sort('-createdAt')
      .skip(skip)
      .limit(limit);

    if (eventType) {
      attendanceQuery.populate({
        path: 'eventId',
        match: { eventType }
      });
    }

    const [attendance, total] = await Promise.all([
      attendanceQuery.exec(),
      Attendance.countDocuments(query)
    ]);

    // Filter out null events (when eventType filter doesn't match)
    const filteredAttendance = attendance.filter(a => a.eventId);

    // Calculate attendance statistics
    const stats = await this.calculateUserAttendanceStats(userId, startDate, endDate);

    return {
      attendance: filteredAttendance,
      statistics: stats,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Bulk import users from CSV data
   */
  async bulkImportUsers(userData, importedBy, importedByRole, ipAddress) {
    const results = {
      successful: [],
      failed: [],
      total: userData.length
    };

    for (const user of userData) {
      try {
        const createdUser = await this.createUser(user, importedBy, importedByRole, ipAddress);
        results.successful.push({
          phoneNumber: user.phoneNumber,
          userId: createdUser._id,
          message: 'User created successfully'
        });
      } catch (error) {
        results.failed.push({
          phoneNumber: user.phoneNumber,
          error: error.message
        });
      }
    }

    // Log bulk import
    await AuditLog.logAction({
      userId: importedBy,
      action: AUDIT_ACTIONS.USER_BULK_IMPORT,
      resource: 'user',
      details: {
        totalAttempted: results.total,
        successful: results.successful.length,
        failed: results.failed.length
      },
      ipAddress,
      result: { success: true }
    });

    return results;
  }

  /**
   * Soft delete user
   */
  async deleteUser(userId, deletedBy, deletedByRole, ipAddress) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canDeleteUser(deletedBy, deletedByRole, user)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Soft delete
    user.isActive = false;
    user.deletedAt = new Date();
    user.deletedBy = deletedBy;
    await user.save();

    // Log user deletion
    await AuditLog.logAction({
      userId: deletedBy,
      action: AUDIT_ACTIONS.USER_DELETE,
      resource: 'user',
      resourceId: userId,
      details: {
        targetUserId: userId,
        phoneNumber: user.phoneNumber,
        role: user.role
      },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: SUCCESS_MESSAGES.USER_DELETED };
  }

  /**
   * Calculate user attendance statistics
   */
  async calculateUserAttendanceStats(userId, startDate, endDate) {
    const matchConditions = { userId };
    
    if (startDate || endDate) {
      matchConditions.createdAt = {};
      if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
      if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
    }

    const stats = await Attendance.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalEvents = stats.reduce((sum, stat) => sum + stat.count, 0);
    const presentCount = stats.find(s => s._id === 'present')?.count || 0;
    const attendanceRate = totalEvents > 0 ? ((presentCount / totalEvents) * 100).toFixed(2) : 0;

    return {
      totalEvents,
      present: presentCount,
      absent: stats.find(s => s._id === 'absent')?.count || 0,
      excused: stats.find(s => s._id === 'excused')?.count || 0,
      late: stats.find(s => s._id === 'late')?.count || 0,
      attendanceRate: parseFloat(attendanceRate)
    };
  }

  /**
   * Search users by various criteria
   */
  async searchUsers(filters = {}) {
    const {
      search,
      role,
      department,
      isActive,
      scopedAccess,
      currentUserRole,
      departmentId
    } = filters;

    const query = {};

    // Text search
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by role
    if (role) query.role = role;

    // Filter by department
    if (department) query.departmentId = department;

    // Filter by active status
    if (typeof isActive === 'boolean') query.isActive = isActive;

    // Apply scoped access for department leaders
    if (scopedAccess && currentUserRole === USER_ROLES.DEPARTMENT_LEADER && departmentId) {
      query.departmentId = departmentId;
    }

    const users = await User.find(query)
      .populate('departmentId', 'name category')
      .populate('ministryId', 'name')
      .select('-password')
      .sort('fullName')
      .limit(100); // Limit search results

    return users;
  }

  /**
   * Get user statistics based on role permissions
   */
  async getUserStats(userRole, userDepartmentId) {
    const stats = {};

    // Base query for scoped access
    const baseQuery = {};
    if (userRole === USER_ROLES.DEPARTMENT_LEADER && userDepartmentId) {
      baseQuery.departmentId = userDepartmentId;
    }

    // Total users
    stats.totalUsers = await User.countDocuments({ ...baseQuery, isActive: true });

    // Users by role
    const roleStats = await User.aggregate([
      { $match: { ...baseQuery, isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    stats.usersByRole = roleStats.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    // New users this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    stats.newUsersThisMonth = await User.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfMonth }
    });

    // Active vs Inactive users
    stats.activeUsers = stats.totalUsers;
    stats.inactiveUsers = await User.countDocuments({ ...baseQuery, isActive: false });

    // Verified vs Unverified users
    stats.verifiedUsers = await User.countDocuments({ ...baseQuery, isActive: true, isVerified: true });
    stats.unverifiedUsers = await User.countDocuments({ ...baseQuery, isActive: true, isVerified: false });

    return stats;
  }

  /**
   * Get user's effective permissions based on their role
   */
  async getUserPermissions(userId, requestingUserId, requestingUserRole) {
    const user = await this.getUserById(userId, requestingUserId, requestingUserRole);

    // Define permissions based on role
    const rolePermissions = {
      [USER_ROLES.SUPER_ADMIN]: {
        users: ['create', 'read', 'update', 'delete', 'assign_role', 'export', 'deactivate'],
        departments: ['create', 'read', 'update', 'delete', 'assign_leader'],
        events: ['create', 'read', 'update', 'delete', 'approve', 'cancel'],
        attendance: ['create', 'read', 'update', 'delete', 'mark', 'export'],
        reports: ['view_all', 'export', 'analytics'],
        settings: ['manage_system', 'manage_roles', 'manage_permissions'],
        audit: ['view_all']
      },
      [USER_ROLES.SENIOR_PASTOR]: {
        users: ['create', 'read', 'update', 'assign_role', 'export'],
        departments: ['read', 'assign_leader'],
        events: ['create', 'read', 'update', 'approve'],
        attendance: ['read', 'export'],
        reports: ['view_all', 'export', 'analytics'],
        audit: ['view_all']
      },
      [USER_ROLES.ASSOCIATE_PASTOR]: {
        users: ['create', 'read', 'update', 'export'],
        departments: ['read', 'update'],
        events: ['create', 'read', 'update'],
        attendance: ['read', 'mark', 'export'],
        reports: ['view_department', 'export'],
        audit: ['view_own']
      },
      [USER_ROLES.PASTOR]: {
        users: ['read'],
        departments: ['read'],
        events: ['create', 'read', 'update'],
        attendance: ['read', 'mark'],
        reports: ['view_basic'],
        audit: ['view_own']
      },
      [USER_ROLES.DEPARTMENT_LEADER]: {
        users: ['read'],
        departments: ['read', 'update_own'],
        events: ['create', 'read', 'update'],
        attendance: ['read', 'mark', 'export'],
        reports: ['view_department'],
        audit: ['view_own']
      },
      [USER_ROLES.CLOCKER]: {
        users: ['read_limited'],
        events: ['create', 'read', 'update_own'],
        attendance: ['mark'],
        reports: ['view_own'],
        audit: ['view_own']
      },
      [USER_ROLES.MEMBER]: {
        users: ['read_own'],
        events: ['read'],
        attendance: ['view_own'],
        reports: ['view_own']
      }
    };

    const permissions = rolePermissions[user.role] || rolePermissions[USER_ROLES.MEMBER];

    return {
      role: user.role,
      permissions,
      scopedAccess: {
        departmentId: user.departmentId,
        ministryId: user.ministryId,
        clockerScopes: user.clockerScopes
      }
    };
  }

  /**
   * Add user to multiple departments
   */
  async addUserToDepartments(userId, departmentIds, addedBy, addedByRole, ipAddress) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyUser(addedBy, addedByRole, user)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Validate all department IDs
    const departments = await Department.find({ _id: { $in: departmentIds } });
    if (departments.length !== departmentIds.length) {
      throw ApiError.badRequest('One or more invalid department IDs', ERROR_CODES.INVALID_INPUT);
    }

    // Update user with new departments (keeping existing ones)
    const existingDeptIds = user.departments || [];
    const newDeptIds = [...new Set([...existingDeptIds.map(d => d.toString()), ...departmentIds])];
    
    user.departments = newDeptIds;
    await user.save();

    // Log the action
    await AuditLog.logAction({
      userId: addedBy,
      action: AUDIT_ACTIONS.USER_UPDATE,
      resource: 'user',
      resourceId: userId,
      details: {
        targetUserId: userId,
        departmentsAdded: departmentIds,
        action: 'add_to_departments'
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getUserById(userId, addedBy, addedByRole);
  }

  /**
   * Remove user from a department
   */
  async removeUserFromDepartment(userId, departmentId, removedBy, removedByRole, ipAddress) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyUser(removedBy, removedByRole, user)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Check if user is in the department
    if (user.departmentId?.toString() !== departmentId) {
      throw ApiError.badRequest('User is not in this department', ERROR_CODES.INVALID_INPUT);
    }

    // Remove user from department
    user.departmentId = null;
    await user.save();

    // Log the action
    await AuditLog.logAction({
      userId: removedBy,
      action: AUDIT_ACTIONS.USER_UPDATE,
      resource: 'user',
      resourceId: userId,
      details: {
        targetUserId: userId,
        departmentRemoved: departmentId,
        action: 'remove_from_department'
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getUserById(userId, removedBy, removedByRole);
  }

  // Helper methods for permission checking
  canAccessUser(requestingUserId, requestingUserRole, targetUser) {
    if (requestingUserId.toString() === targetUser._id.toString()) return true;
    
    const roleLevel = ROLE_HIERARCHY[requestingUserRole] || 0;
    const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    
    return roleLevel >= targetRoleLevel;
  }

  canModifyUser(modifyingUserId, modifyingUserRole, targetUser) {
    if (modifyingUserId.toString() === targetUser._id.toString()) return true;
    
    const roleLevel = ROLE_HIERARCHY[modifyingUserRole] || 0;
    const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    
    return roleLevel > targetRoleLevel;
  }

  canAssignRole(assignerRole, targetRole) {
    const assignerLevel = ROLE_HIERARCHY[assignerRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] || 0;
    
    return assignerLevel > targetLevel;
  }

  canDeleteUser(deleterRole, deleterUserId, targetUser) {
    if (deleterUserId.toString() === targetUser._id.toString()) return false; // Can't delete self
    
    const deleterLevel = ROLE_HIERARCHY[deleterRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    
    return deleterLevel > targetLevel;
  }
}

module.exports = new UserService(); 
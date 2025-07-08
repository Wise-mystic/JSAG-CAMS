const Department = require('../models/Department.model');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const { 
  USER_ROLES, 
  DEPARTMENT_CATEGORIES,
  ROLE_HIERARCHY,
  ERROR_CODES, 
  AUDIT_ACTIONS,
  SUCCESS_MESSAGES 
} = require('../utils/constants');
const mongoose = require('mongoose');

class DepartmentService {
  /**
   * Get all departments with filtering and hierarchy
   */
  async getAllDepartments(filters = {}, options = {}) {
    const {
      page = 1,
      limit = 50,
      sort = 'name',
      search,
      category,
      isActive,
      includeHierarchy = false
    } = options;

    const query = {};

    // Apply filters
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) query.category = category;
    if (typeof isActive === 'boolean') query.isActive = isActive;

    // Role-based access control
    if (filters.scopedAccess && filters.currentUserRole === USER_ROLES.DEPARTMENT_LEADER) {
      query._id = { $in: filters.departmentIds };
    }

    const skip = (page - 1) * limit;

    const [departments, total] = await Promise.all([
      Department.find(query)
        .populate('leaderId', 'fullName phoneNumber role')
        .populate('parentDepartmentId', 'name category')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Department.countDocuments(query)
    ]);

    // Build hierarchy if requested
    let hierarchicalData = departments;
    if (includeHierarchy) {
      hierarchicalData = this.buildDepartmentHierarchy(departments);
    }

    // Get member counts for each department
    const departmentIds = departments.map(d => d._id);
    const memberCounts = await User.aggregate([
      { $match: { departmentIds: { $in: departmentIds }, isActive: true } },
      { $unwind: '$departmentIds' },
      { $group: { _id: '$departmentIds', count: { $sum: 1 } } }
    ]);

    // Attach member counts
    hierarchicalData.forEach(dept => {
      const memberCount = memberCounts.find(mc => mc._id.toString() === dept._id.toString());
      dept.memberCount = memberCount ? memberCount.count : 0;
    });

    return {
      departments: hierarchicalData,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalDepartments: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get department by ID with full details
   */
  async getDepartmentById(departmentId, requestingUserId, requestingUserRole) {
    // Validate input parameters
    if (!departmentId) {
      throw ApiError.badRequest('Department ID is required', ERROR_CODES.INVALID_INPUT);
    }

    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw ApiError.badRequest('Invalid department ID format', ERROR_CODES.INVALID_INPUT);
    }

    try {
      const department = await Department.findById(departmentId)
        .populate('leaderId', 'fullName phoneNumber role email')
        .populate('parentDepartmentId', 'name category leaderId');

      if (!department) {
        throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
      }

      // Check access permissions
      if (!this.canAccessDepartment(requestingUserId, requestingUserRole, department)) {
        throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
      }

      // Get department statistics
      const stats = await this.getDepartmentStatistics(departmentId);
      
      // Get sub-departments
      const subDepartments = await Department.find({ 
        parentDepartmentId: departmentId,
        isActive: true 
      }).populate('leaderId', 'fullName role');

      return {
        ...department.toObject(),
        statistics: stats,
        subDepartments
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      logger.error('Failed to get department by ID', {
        error: error.message,
        departmentId,
        requestingUserId
      });
      throw ApiError.internalError('Failed to retrieve department information');
    }
  }

  /**
   * Create new department with validation
   */
  async createDepartment(departmentData, createdBy, createdByRole, ipAddress) {
    const {
      name,
      description,
      category,
      leaderId,
      parentDepartmentId,
      allowsOverlap = true,
      settings = {}
    } = departmentData;

    // Check permissions
    if (!this.canManageDepartments(createdByRole)) {
      throw ApiError.forbidden(
        'Insufficient permissions to create departments',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Check if department name already exists
    const existingDepartment = await Department.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      isActive: true 
    });

    if (existingDepartment) {
      throw ApiError.conflict('Department name already exists', ERROR_CODES.DUPLICATE_ENTRY);
    }

    // Validate leader assignment
    if (leaderId) {
      const leader = await User.findById(leaderId);
      if (!leader) {
        throw ApiError.badRequest('Invalid leader ID', ERROR_CODES.INVALID_INPUT);
      }

      // Check if leader can be assigned to this department
      if (!this.canAssignLeader(createdByRole, leader.role)) {
        throw ApiError.forbidden(
          'Cannot assign this user as department leader',
          ERROR_CODES.INSUFFICIENT_PERMISSIONS
        );
      }

      // Check if leader is already leading another department
      const existingLeadership = await Department.findOne({ 
        leaderId, 
        isActive: true,
        _id: { $ne: departmentId } 
      });

      if (existingLeadership) {
        throw ApiError.conflict(
          'User is already leading another department',
          ERROR_CODES.BUSINESS_RULE_VIOLATION
        );
      }
    }

    // Validate parent department
    if (parentDepartmentId) {
      const parentDepartment = await Department.findById(parentDepartmentId);
      if (!parentDepartment || !parentDepartment.isActive) {
        throw ApiError.badRequest('Invalid parent department', ERROR_CODES.INVALID_INPUT);
      }
    }

    // Create department
    const department = new Department({
      name,
      description,
      category,
      leaderId,
      parentDepartmentId,
      allowsOverlap,
      settings,
      metadata: {
        createdBy,
        memberCount: 0,
        lastActivityDate: new Date()
      }
    });

    await department.save();

    // If leader is assigned, add department to their departmentIds
    if (leaderId) {
      await User.findByIdAndUpdate(leaderId, {
        $addToSet: { departmentIds: department._id }
      });
    }

    // Log department creation
    await AuditLog.logAction({
      userId: createdBy,
      action: AUDIT_ACTIONS.DEPARTMENT_CREATE,
      resource: 'department',
      resourceId: department._id,
      details: {
        departmentName: name,
        category,
        leaderId
      },
      ipAddress
    });

    // Return created department with populated fields
    return Department.findById(department._id)
      .populate('leaderId', 'fullName phoneNumber role')
      .populate('parentDepartmentId', 'name category');
  }

  /**
   * Update department information
   */
  async updateDepartment(departmentId, updateData, updatedBy, updatedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyDepartment(updatedBy, updatedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    const {
      name,
      description,
      leaderId,
      isActive,
      settings
    } = updateData;

    const updatePayload = {};
    const changes = {};

    // Update name with uniqueness check
    if (name && name !== department.name) {
      const existingDepartment = await Department.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        isActive: true,
        _id: { $ne: departmentId }
      });

      if (existingDepartment) {
        throw ApiError.conflict('Department name already exists', ERROR_CODES.DUPLICATE_ENTRY);
      }

      updatePayload.name = name;
      changes.name = { from: department.name, to: name };
    }

    // Update description
    if (description !== undefined && description !== department.description) {
      updatePayload.description = description;
      changes.description = { from: department.description, to: description };
    }

    // Update leader with validation
    if (leaderId !== undefined && leaderId?.toString() !== department.leaderId?.toString()) {
      if (leaderId) {
        const newLeader = await User.findById(leaderId);
        if (!newLeader) {
          throw ApiError.badRequest('Invalid leader ID', ERROR_CODES.INVALID_INPUT);
        }

        // Check if new leader can be assigned
        if (!this.canAssignLeader(updatedByRole, newLeader.role)) {
          throw ApiError.forbidden(
            'Cannot assign this user as department leader',
            ERROR_CODES.INSUFFICIENT_PERMISSIONS
          );
        }

        // Update new leader's department assignment
        await User.findByIdAndUpdate(leaderId, { 
          departmentId: department._id,
          role: USER_ROLES.DEPARTMENT_LEADER
        });
      }

      // Remove previous leader's assignment
      if (department.leaderId) {
        await User.findByIdAndUpdate(department.leaderId, { 
          $unset: { departmentId: 1 },
          role: USER_ROLES.MEMBER // Demote to member
        });
      }

      updatePayload.leaderId = leaderId;
      changes.leaderId = { from: department.leaderId, to: leaderId };
    }

    // Update active status
    if (typeof isActive === 'boolean' && isActive !== department.isActive) {
      updatePayload.isActive = isActive;
      changes.isActive = { from: department.isActive, to: isActive };

      // If deactivating, handle cleanup
      if (!isActive) {
        await this.handleDepartmentDeactivation(departmentId);
      }
    }

    // Update settings
    if (settings !== undefined) {
      updatePayload.settings = { ...department.settings, ...settings };
      changes.settings = { from: department.settings, to: updatePayload.settings };
    }

    if (Object.keys(updatePayload).length === 0) {
      throw ApiError.badRequest('No valid updates provided', ERROR_CODES.INVALID_INPUT);
    }

    const updatedDepartment = await Department.findByIdAndUpdate(
      departmentId,
      { ...updatePayload, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('leaderId parentDepartmentId');

    // Log department update
    await AuditLog.logAction({
      userId: updatedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_UPDATE,
      resource: 'department',
      resourceId: departmentId,
      details: { changes },
      ipAddress,
      result: { success: true }
    });

    return updatedDepartment;
  }

  /**
   * Get department members with filtering
   */
  async getDepartmentMembers(departmentId, options = {}) {
    const {
      page = 1,
      limit = 50,
      sort = 'fullName',
      search,
      role,
      isActive
    } = options;

    const query = {
      departmentIds: departmentId,
      isActive: typeof isActive === 'boolean' ? isActive : true
    };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) query.role = role;

    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      User.find(query)
        .populate('departmentIds', 'name category')
        .populate('ministryId', 'name')
        .populate('prayerTribeId', 'name dayOfWeek')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-password'),
      User.countDocuments(query)
    ]);

    return {
      members,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalMembers: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Add members to department
   */
  async addMembersToDepartment(departmentId, memberIds, addedBy, addedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department || !department.isActive) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canManageDepartmentMembers(addedBy, addedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Initialize result arrays
    const successful = [];
    const failed = [];
    const warnings = [];

    // Validate members exist and can be added
    const members = await User.find({ _id: { $in: memberIds } });
    if (members.length !== memberIds.length) {
      const foundIds = members.map(m => m._id.toString());
      memberIds.forEach(id => {
        if (!foundIds.includes(id.toString())) {
          failed.push({ id, reason: 'User not found' });
        }
      });
      if (failed.length === memberIds.length) {
        throw ApiError.badRequest('All member IDs are invalid', ERROR_CODES.INVALID_INPUT);
      }
    }

    // Check mutual exclusivity rules and current membership
    for (const member of members) {
      const memberId = member._id.toString();
      
      // Skip if already a member
      if (member.departmentIds && member.departmentIds.includes(departmentId)) {
        warnings.push({ id: memberId, reason: 'Already a member of this department' });
        continue;
      }

      if (!department.allowsOverlap) {
        const violatesMutualExclusivity = await this.violatesMutualExclusivity(
          memberId,
          department.category
        );
        if (violatesMutualExclusivity) {
          failed.push({
            id: memberId,
            reason: `Cannot be in multiple departments of category ${department.category}`
          });
          continue;
        }
      }
      
      successful.push(memberId);
    }

    if (successful.length > 0) {
      // Add successful members to department
      await User.updateMany(
        { _id: { $in: successful } },
        { $addToSet: { departmentIds: departmentId } }
      );

      // Log member additions
      for (const memberId of successful) {
        await AuditLog.logAction({
          userId: addedBy,
          action: AUDIT_ACTIONS.DEPARTMENT_ADD_MEMBER,
          resource: 'department',
          resourceId: departmentId,
          details: {
            memberId,
            departmentId
          },
          ipAddress,
          result: { success: true }
        });
      }
    }

    const updatedMembers = await this.getDepartmentMembers(departmentId);

    return {
      successful,
      failed,
      warnings,
      members: updatedMembers.members,
      pagination: updatedMembers.pagination
    };
  }

  /**
   * Remove member from department
   */
  async removeMemberFromDepartment(departmentId, memberId, removedBy, removedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department || !department.isActive) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canManageDepartmentMembers(removedBy, removedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Check if member exists and is in department
    const member = await User.findOne({ 
      _id: memberId,
      departmentIds: departmentId
    });

    if (!member) {
      throw ApiError.notFound('Member not found in department', ERROR_CODES.USER_NOT_FOUND);
    }

    // Cannot remove department leader
    if (department.leaderId?.toString() === memberId) {
      throw ApiError.badRequest(
        'Cannot remove department leader. Assign a new leader first.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Remove member from department
    await User.findByIdAndUpdate(memberId, {
      $pull: { departmentIds: departmentId }
    });

    // Log member removal
    await AuditLog.logAction({
      userId: removedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_REMOVE_MEMBER,
      resource: 'department',
      resourceId: departmentId,
      details: {
        memberId,
        departmentId
      },
      ipAddress,
      result: { success: true }
    });

    return { message: 'Member removed successfully' };
  }

  /**
   * Check if department can be safely deleted with detailed feedback
   */
  async canDeleteDepartmentSafe(departmentId, requestingUserId, requestingUserRole) {
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw ApiError.badRequest('Invalid department ID format', ERROR_CODES.INVALID_INPUT);
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canDeleteDepartment(requestingUserId, requestingUserRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    const blockers = [];
    const suggestions = [];

    // Check for active members
    const memberCount = await User.countDocuments({
      departmentIds: departmentId,
      isActive: true
    });

    if (memberCount > 0) {
      blockers.push({
        type: 'active_members',
        count: memberCount,
        description: `Department has ${memberCount} active member(s)`
      });
      suggestions.push('Remove all members from the department before deletion');
    }

    // Check for sub-departments
    const subDepartmentCount = await Department.countDocuments({
      parentDepartmentId: departmentId,
      isActive: true
    });

    if (subDepartmentCount > 0) {
      blockers.push({
        type: 'sub_departments',
        count: subDepartmentCount,
        description: `Department has ${subDepartmentCount} active sub-department(s)`
      });
      suggestions.push('Delete or reassign sub-departments before deletion');
    }

    // Check for active events
    const Event = require('../models/Event.model');
    const activeEventCount = await Event.countDocuments({
      departmentId: departmentId,
      status: { $in: ['scheduled', 'ongoing'] }
    });

    if (activeEventCount > 0) {
      blockers.push({
        type: 'active_events',
        count: activeEventCount,
        description: `Department has ${activeEventCount} active event(s)`
      });
      suggestions.push('Complete or cancel active events before deletion');
    }

    const canDelete = blockers.length === 0;
    const reason = canDelete ? 
      'Department can be safely deleted' : 
      `Cannot delete department: ${blockers.map(b => b.description).join(', ')}`;

    return {
      canDelete,
      reason,
      blockers,
      suggestions,
      department: {
        id: department._id,
        name: department.name,
        category: department.category,
        isActive: department.isActive
      }
    };
  }

  /**
   * Delete department (improved error handling)
   */
  async deleteDepartment(departmentId, deletedBy, deletedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canDeleteDepartment(deletedBy, deletedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Enhanced validation before deletion
    const safetyCheck = await this.canDeleteDepartmentSafe(departmentId, deletedBy, deletedByRole);
    if (!safetyCheck.canDelete) {
      throw ApiError.badRequest(safetyCheck.reason, ERROR_CODES.BUSINESS_RULE_VIOLATION);
    }

    // Soft delete
    department.isActive = false;
    department.metadata.deletedAt = new Date();
    department.metadata.deletedBy = deletedBy;
    await department.save();

    // Log deletion
    await AuditLog.logAction({
      userId: deletedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_DELETE,
      resource: 'department',
      resourceId: departmentId,
      details: {
        departmentName: department.name,
        category: department.category,
        previousLeader: department.leaderId
      },
      ipAddress
    });

    return department;
  }

  /**
   * Get department attendance summary
   */
  async getDepartmentAttendanceSummary(departmentId, options = {}) {
    const { startDate, endDate } = options;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get department members
    const members = await User.find({ departmentId, isActive: true }).select('_id');
    const memberIds = members.map(m => m._id);

    // Get attendance statistics
    const attendanceStats = await this.calculateDepartmentAttendanceStats(memberIds, dateFilter);
    
    // Get event statistics
    const eventStats = await this.calculateDepartmentEventStats(departmentId, dateFilter);

    return {
      departmentId,
      period: { startDate, endDate },
      memberCount: memberIds.length,
      attendance: attendanceStats,
      events: eventStats
    };
  }

  // Helper methods
  buildDepartmentHierarchy(departments) {
    const departmentMap = new Map();
    const rootDepartments = [];

    // Create department map
    departments.forEach(dept => {
      departmentMap.set(dept._id.toString(), { ...dept.toObject(), subDepartments: [] });
    });

    // Build hierarchy
    departments.forEach(dept => {
      if (dept.parentDepartmentId) {
        const parent = departmentMap.get(dept.parentDepartmentId.toString());
        if (parent) {
          parent.subDepartments.push(departmentMap.get(dept._id.toString()));
        }
      } else {
        rootDepartments.push(departmentMap.get(dept._id.toString()));
      }
    });

    return rootDepartments;
  }

  async getDepartmentStatistics(departmentId) {
    const [memberCount, activeEvents, recentAttendance] = await Promise.all([
      User.countDocuments({ departmentId, isActive: true }),
      this.getActiveDepartmentEvents(departmentId),
      this.getRecentDepartmentAttendance(departmentId)
    ]);

    return {
      memberCount,
      activeEvents: activeEvents.length,
      averageAttendance: recentAttendance.averageRate || 0,
      lastActivityDate: recentAttendance.lastActivity
    };
  }

  async violatesMutualExclusivity(memberId, newDepartmentCategory) {
    // Music and Ushering departments are mutually exclusive
    if (newDepartmentCategory === DEPARTMENT_CATEGORIES.MUSIC) {
      const usheringMembership = await User.findOne({
        _id: memberId,
        departmentId: { $exists: true }
      }).populate('departmentId');

      return usheringMembership?.departmentId?.category === DEPARTMENT_CATEGORIES.USHERING;
    }

    if (newDepartmentCategory === DEPARTMENT_CATEGORIES.USHERING) {
      const musicMembership = await User.findOne({
        _id: memberId,
        departmentId: { $exists: true }
      }).populate('departmentId');

      return musicMembership?.departmentId?.category === DEPARTMENT_CATEGORIES.MUSIC;
    }

    return false;
  }

  async transferMemberBetweenDepartments(memberId, fromDepartmentId, toDepartmentId, transferredBy) {
    // Log the transfer
    await AuditLog.logAction({
      userId: transferredBy,
      action: AUDIT_ACTIONS.DEPARTMENT_MEMBER_TRANSFER,
      resource: 'department',
      resourceId: toDepartmentId,
      details: {
        memberId,
        fromDepartmentId,
        toDepartmentId
      },
      result: { success: true }
    });

    // Update member's department
    await User.findByIdAndUpdate(memberId, { departmentId: toDepartmentId });
  }

  async handleDepartmentDeactivation(departmentId) {
    // Remove department assignment from all members
    await User.updateMany(
      { departmentId },
      { $unset: { departmentId: 1 } }
    );

    // Deactivate sub-departments
    await Department.updateMany(
      { parentDepartmentId: departmentId },
      { isActive: false, deletedAt: new Date() }
    );
  }

  // Permission checking methods
  canAccessDepartment(userId, userRole, department) {
    // Super admin and pastors can access all departments
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Department leaders can access their own department
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      return department.leaderId?.toString() === userId.toString();
    }

    return false;
  }

  canManageDepartments(userRole) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR];
  }

  canModifyDepartment(userId, userRole, department) {
    // High-level roles can modify any department
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Department leaders can modify their own department (limited)
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      return department.leaderId?.toString() === userId.toString();
    }

    return false;
  }

  canManageDepartmentMembers(userId, userRole, department) {
    return this.canModifyDepartment(userId, userRole, department);
  }

  canDeleteDepartment(userId, userRole, department) {
    // Only super admins and senior pastors can delete departments
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.SENIOR_PASTOR];
  }

  canAssignLeader(assignerRole, candidateRole) {
    const assignerLevel = ROLE_HIERARCHY[assignerRole] || 0;
    const candidateLevel = ROLE_HIERARCHY[candidateRole] || 0;
    
    return assignerLevel > candidateLevel;
  }

  async getActiveDepartmentEvents(departmentId) {
    const Event = require('../models/Event.model');
    return await Event.find({
      departmentId,
      status: { $in: ['upcoming', 'active'] },
      isActive: true
    }).limit(5);
  }

  async getRecentDepartmentAttendance(departmentId) {
    const Attendance = require('../models/Attendance.model');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get members of this department
    const members = await User.find({ departmentId, isActive: true }).select('_id');
    const memberIds = members.map(m => m._id);

    const stats = await Attendance.aggregate([
      {
        $match: {
          userId: { $in: memberIds },
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          lastActivity: { $max: '$createdAt' }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === 'present')?.count || 0;
    const lastActivity = stats.reduce((latest, stat) => 
      stat.lastActivity > latest ? stat.lastActivity : latest, 
      null
    );

    return {
      averageRate: total > 0 ? ((present / total) * 100).toFixed(2) : 0,
      lastActivity
    };
  }

  async calculateDepartmentAttendanceStats(memberIds, dateFilter) {
    const Attendance = require('../models/Attendance.model');
    
    const matchConditions = {
      userId: { $in: memberIds },
      ...dateFilter
    };

    const stats = await Attendance.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === 'present')?.count || 0;

    return {
      total,
      present,
      absent: stats.find(s => s._id === 'absent')?.count || 0,
      excused: stats.find(s => s._id === 'excused')?.count || 0,
      late: stats.find(s => s._id === 'late')?.count || 0,
      attendanceRate: total > 0 ? parseFloat(((present / total) * 100).toFixed(2)) : 0
    };
  }

  async calculateDepartmentEventStats(departmentId, dateFilter) {
    const Event = require('../models/Event.model');
    
    const matchConditions = {
      departmentId: new mongoose.Types.ObjectId(departmentId),
      ...dateFilter
    };

    const stats = await Event.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    return {
      total: stats.reduce((sum, stat) => sum + stat.count, 0),
      completed: stats.find(s => s._id === 'completed')?.count || 0,
      upcoming: stats.find(s => s._id === 'upcoming')?.count || 0,
      active: stats.find(s => s._id === 'active')?.count || 0,
      cancelled: stats.find(s => s._id === 'cancelled')?.count || 0
    };
  }

  /**
   * Assign a leader to a department
   */
  async assignDepartmentLeader(departmentId, userId, assignedBy, assignedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyDepartment(assignedBy, assignedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Validate the new leader
    const newLeader = await User.findById(userId);
    if (!newLeader) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check if user can be a department leader
    if (!this.canAssignLeader(assignedByRole, newLeader.role)) {
      throw ApiError.forbidden(
        'Cannot assign this user as department leader due to role restrictions',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Store old leader for audit
    const oldLeaderId = department.leaderId;

    // Update department leader
    department.leaderId = userId;
    await department.save();

    // Update the new leader's role if needed
    if (newLeader.role === USER_ROLES.MEMBER) {
      newLeader.role = USER_ROLES.DEPARTMENT_LEADER;
      await newLeader.save();
    }

    // Log the change
    await AuditLog.logAction({
      userId: assignedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_UPDATE,
      resource: 'department',
      resourceId: departmentId,
      details: {
        action: 'assign_leader',
        oldLeaderId,
        newLeaderId: userId,
        departmentName: department.name
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getDepartmentById(departmentId, assignedBy, assignedByRole);
  }

  /**
   * Get events for a specific department
   */
  async getDepartmentEvents(departmentId, options = {}) {
    const Event = require('../models/Event.model');
    
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      eventType,
      status
    } = options;

    const query = {
      $or: [
        { departmentId: departmentId },
        { 'targetIds': departmentId, targetAudience: 'department' }
      ],
      isActive: true
    };

    // Date filter
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    // Event type filter
    if (eventType) query.eventType = eventType;

    // Status filter
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      Event.find(query)
        .populate('createdBy', 'fullName role')
        .populate('departmentId', 'name category')
        .sort('-startTime')
        .skip(skip)
        .limit(limit),
      Event.countDocuments(query)
    ]);

    return {
      events,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalEvents: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get overall department statistics
   */
  async getAllDepartmentStatistics(requestingUserId, requestingUserRole, options = {}) {
    const { timeframe = '30d' } = options;
    
    // Calculate date range based on timeframe
    const now = new Date();
    let startDate;
    
    switch (timeframe) {
      case '7d':
        startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case '30d':
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case '90d':
        startDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
        break;
      case '1y':
        startDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
        break;
      default:
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    try {
      // Get departments accessible to user
      const filters = {
        scopedAccess: !this.canAccessAllDepartments(requestingUserRole),
        currentUserRole: requestingUserRole,
        departmentIds: await this.getUserAccessibleDepartmentIds(requestingUserId, requestingUserRole)
      };

      const departments = await Department.find(this.buildDepartmentQuery(filters))
        .populate('leaderId', 'fullName role')
        .lean();

      // Calculate overall statistics
      const totalDepartments = departments.length;
      const activeDepartments = departments.filter(d => d.isActive).length;
      const departmentsWithLeaders = departments.filter(d => d.leaderId).length;
      
      // Get member statistics
      const memberStats = await User.aggregate([
        {
          $match: {
            departmentIds: { $in: departments.map(d => d._id) }
          }
        },
        {
          $group: {
            _id: null,
            totalMembers: { $sum: 1 },
            activeMembers: {
              $sum: {
                $cond: [{ $eq: ['$isActive', true] }, 1, 0]
              }
            }
          }
        }
      ]);

      // Get recent activity statistics
      const recentActivity = await AuditLog.aggregate([
        {
          $match: {
            resource: 'department',
            createdAt: { $gte: startDate },
            userId: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 }
          }
        }
      ]);

      // Calculate department distribution by category
      const categoryDistribution = departments.reduce((acc, dept) => {
        acc[dept.category] = (acc[dept.category] || 0) + 1;
        return acc;
      }, {});

      return {
        overview: {
          totalDepartments,
          activeDepartments,
          inactiveDepartments: totalDepartments - activeDepartments,
          departmentsWithLeaders,
          departmentsWithoutLeaders: totalDepartments - departmentsWithLeaders,
          leadersAssignmentRate: totalDepartments > 0 ? ((departmentsWithLeaders / totalDepartments) * 100).toFixed(1) : 0
        },
        members: {
          totalMembers: memberStats[0]?.totalMembers || 0,
          activeMembers: memberStats[0]?.activeMembers || 0,
          averageMembersPerDepartment: totalDepartments > 0 ? 
            ((memberStats[0]?.totalMembers || 0) / totalDepartments).toFixed(1) : 0
        },
        distribution: {
          byCategory: categoryDistribution
        },
        recentActivity: recentActivity.reduce((acc, activity) => {
          acc[activity._id] = activity.count;
          return acc;
        }, {}),
        timeframe: {
          period: timeframe,
          startDate: startDate.toISOString(),
          endDate: now.toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to get department statistics', {
        error: error.message,
        requestingUserId,
        timeframe
      });
      throw ApiError.internalError('Failed to retrieve department statistics');
    }
  }

  /**
   * Helper: Build department query based on filters
   */
  buildDepartmentQuery(filters) {
    const query = { isActive: true };

    if (filters.scopedAccess && filters.departmentIds && filters.departmentIds.length > 0) {
      query._id = { $in: filters.departmentIds };
    }

    return query;
  }

  /**
   * Helper: Check if user can access all departments
   */
  canAccessAllDepartments(userRole) {
    return [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR].includes(userRole);
  }

  /**
   * Helper: Get department IDs accessible to user
   */
  async getUserAccessibleDepartmentIds(userId, userRole) {
    if (this.canAccessAllDepartments(userRole)) {
      return [];
    }

    const user = await User.findById(userId).select('departmentIds');
    return user?.departmentIds || [];
  }
}

module.exports = new DepartmentService(); 
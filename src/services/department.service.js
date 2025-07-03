const Department = require('../models/Department.model');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
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
      query._id = filters.departmentId;
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
      { $match: { departmentId: { $in: departmentIds }, isActive: true } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } }
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
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw ApiError.badRequest('Invalid department ID', ERROR_CODES.INVALID_INPUT);
    }

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
      createdBy,
      isActive: true
    });

    await department.save();

    // Update leader's department assignment if provided
    if (leaderId) {
      await User.findByIdAndUpdate(leaderId, { 
        departmentId: department._id,
        role: USER_ROLES.DEPARTMENT_LEADER // Auto-assign department leader role
      });
    }

    // Log department creation
    await AuditLog.logAction({
      userId: createdBy,
      action: AUDIT_ACTIONS.DEPARTMENT_CREATE,
      resource: 'department',
      resourceId: department._id,
      details: {
        name,
        category,
        leaderId,
        parentDepartmentId
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getDepartmentById(department._id, createdBy, createdByRole);
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

    const query = { departmentId };

    // Apply filters
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) query.role = role;
    if (typeof isActive === 'boolean') query.isActive = isActive;

    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .populate('ministryId', 'name')
        .populate('prayerTribes', 'name dayOfWeek')
        .sort(sort)
        .skip(skip)
        .limit(limit),
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
   * Add members to department with validation
   */
  async addMembersToDepartment(departmentId, memberIds, addedBy, addedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canManageDepartmentMembers(addedBy, addedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Validate member IDs
    const members = await User.find({ _id: { $in: memberIds } });
    if (members.length !== memberIds.length) {
      throw ApiError.badRequest('Some member IDs are invalid', ERROR_CODES.INVALID_INPUT);
    }

    const results = {
      successful: [],
      failed: [],
      warnings: []
    };

    for (const member of members) {
      try {
        // Check mutual exclusivity rules
        if (await this.violatesMutualExclusivity(member._id, department.category)) {
          results.failed.push({
            memberId: member._id,
            name: member.fullName,
            reason: 'Violates mutual exclusivity rules (Music/Ushering)'
          });
          continue;
        }

        // Check if member is already in a department
        if (member.departmentId && member.departmentId.toString() !== departmentId.toString()) {
          // Handle department transfer
          await this.transferMemberBetweenDepartments(
            member._id, 
            member.departmentId, 
            departmentId,
            addedBy
          );
          
          results.warnings.push({
            memberId: member._id,
            name: member.fullName,
            message: 'Transferred from another department'
          });
        } else {
          // Simple assignment
          await User.findByIdAndUpdate(member._id, { departmentId });
        }

        results.successful.push({
          memberId: member._id,
          name: member.fullName
        });

      } catch (error) {
        results.failed.push({
          memberId: member._id,
          name: member.fullName,
          reason: error.message
        });
      }
    }

    // Log member addition
    await AuditLog.logAction({
      userId: addedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_MEMBER_ADD,
      resource: 'department',
      resourceId: departmentId,
      details: {
        addedMembers: results.successful.length,
        failedMembers: results.failed.length,
        memberIds
      },
      ipAddress,
      result: { success: true }
    });

    return results;
  }

  /**
   * Remove member from department
   */
  async removeMemberFromDepartment(departmentId, memberId, removedBy, removedByRole, ipAddress) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    const member = await User.findById(memberId);
    if (!member) {
      throw ApiError.notFound('Member not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canManageDepartmentMembers(removedBy, removedByRole, department)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Prevent removing department leader
    if (department.leaderId && department.leaderId.toString() === memberId.toString()) {
      throw ApiError.badRequest(
        'Cannot remove department leader. Assign new leader first.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Remove member from department
    await User.findByIdAndUpdate(memberId, { $unset: { departmentId: 1 } });

    // Log member removal
    await AuditLog.logAction({
      userId: removedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_MEMBER_REMOVE,
      resource: 'department',
      resourceId: departmentId,
      details: {
        removedMemberId: memberId,
        memberName: member.fullName
      },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: SUCCESS_MESSAGES.MEMBER_REMOVED };
  }

  /**
   * Delete/Deactivate department
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

    // Check if department has members
    const memberCount = await User.countDocuments({ departmentId, isActive: true });
    if (memberCount > 0) {
      throw ApiError.badRequest(
        'Cannot delete department with active members. Remove members first.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Check if department has sub-departments
    const subDepartmentCount = await Department.countDocuments({ 
      parentDepartmentId: departmentId, 
      isActive: true 
    });
    if (subDepartmentCount > 0) {
      throw ApiError.badRequest(
        'Cannot delete department with active sub-departments.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Soft delete
    department.isActive = false;
    department.deletedAt = new Date();
    department.deletedBy = deletedBy;
    await department.save();

    // Log department deletion
    await AuditLog.logAction({
      userId: deletedBy,
      action: AUDIT_ACTIONS.DEPARTMENT_DELETE,
      resource: 'department',
      resourceId: departmentId,
      details: {
        name: department.name,
        category: department.category
      },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: SUCCESS_MESSAGES.DEPARTMENT_DELETED };
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
}

module.exports = new DepartmentService(); 
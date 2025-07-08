// Department Controller
// Handles department CRUD, member management, and attendance summary

const DepartmentService = require('../services/department.service');
const { validateInput, schemas } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class DepartmentController {
  // GET /api/v1/departments
  async listDepartments(req, res, next) {
    try {
      const { 
        page, 
        limit, 
        sort, 
        search, 
        category, 
        isActive, 
        includeHierarchy 
      } = req.query;

      const filters = {
        scopedAccess: true,
        currentUserRole: req.user.role,
        departmentIds: req.user.departmentIds
      };

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        sort,
        search,
        category,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        includeHierarchy: includeHierarchy === 'true'
      };

      const result = await DepartmentService.getAllDepartments(filters, options);

      logger.info('Departments retrieved successfully', {
        userId: req.user.id,
        count: result.departments.length,
        filters: options
      });

      res.status(200).json({
        success: true,
        data: result.departments,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('List departments failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/departments
  async createDepartment(req, res, next) {
    try {
      const { error } = schemas.department.create.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const departmentData = req.body;
      const createdBy = req.user.id;
      const createdByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const department = await DepartmentService.createDepartment(
        departmentData, 
        createdBy, 
        createdByRole, 
        ipAddress
      );

      logger.info('Department created successfully', {
        departmentId: department._id,
        name: department.name,
        category: department.category,
        createdBy,
        ipAddress
      });

      res.status(201).json({
        success: true,
        message: 'Department created successfully',
        data: { department }
      });
    } catch (error) {
      logger.error('Create department failed', {
        error: error.message,
        createdBy: req.user.id,
        departmentData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id
  async getDepartment(req, res, next) {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      const requestingUserRole = req.user.role;

      const department = await DepartmentService.getDepartmentById(
        id, 
        requestingUserId, 
        requestingUserRole
      );

      res.status(200).json({
        success: true,
        data: { department }
      });
    } catch (error) {
      logger.error('Get department failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // PUT /api/v1/departments/:id
  async updateDepartment(req, res, next) {
    try {
      const { error } = schemas.department.update.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = req.user.id;
      const updatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const department = await DepartmentService.updateDepartment(
        id, 
        updateData, 
        updatedBy, 
        updatedByRole, 
        ipAddress
      );

      logger.info('Department updated successfully', {
        departmentId: id,
        updatedBy,
        changes: Object.keys(updateData),
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Department updated successfully',
        data: { department }
      });
    } catch (error) {
      logger.error('Update department failed', {
        error: error.message,
        departmentId: req.params.id,
        updatedBy: req.user.id,
        updateData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/members
  async getMembers(req, res, next) {
    try {
      const { id } = req.params;
      const { page, limit, sort, search, role, isActive } = req.query;

      // First verify user can access this department
      await DepartmentService.getDepartmentById(id, req.user.id, req.user.role);

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        sort,
        search,
        role,
        isActive: isActive !== undefined ? isActive === 'true' : undefined
      };

      const result = await DepartmentService.getDepartmentMembers(id, options);

      res.status(200).json({
        success: true,
        data: result.members,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get department members failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/departments/:id/members
  async addMembers(req, res, next) {
    try {
      const { error } = schemas.department.addMember.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const { id } = req.params;
      const { userIds } = req.body; // Using userIds as defined in the route validation
      const addedBy = req.user.id;
      const addedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      // Support both single member and bulk member addition
      const memberIdsArray = Array.isArray(userIds) ? userIds : [userIds];

      const result = await DepartmentService.addMembersToDepartment(
        id,
        memberIdsArray,
        addedBy,
        addedByRole,
        ipAddress
      );

      logger.info('Members added to department', {
        departmentId: id,
        addedBy,
        successful: result.successful.length,
        failed: result.failed.length,
        warnings: result.warnings.length,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: `${result.successful.length} members added successfully`,
        data: result
      });
    } catch (error) {
      logger.error('Add department members failed', {
        error: error.message,
        departmentId: req.params.id,
        addedBy: req.user.id,
        requestBody: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // DELETE /api/v1/departments/:id/members/:userId
  async removeMember(req, res, next) {
    try {
      const { id, userId } = req.params;
      const removedBy = req.user.id;
      const removedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await DepartmentService.removeMemberFromDepartment(
        id,
        userId,
        removedBy,
        removedByRole,
        ipAddress
      );

      logger.info('Member removed from department', {
        departmentId: id,
        removedMemberId: userId,
        removedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error('Remove department member failed', {
        error: error.message,
        departmentId: req.params.id,
        memberId: req.params.userId,
        removedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // DELETE /api/v1/departments/:id - Delete department
  async deleteDepartment(req, res, next) {
    try {
      const { id } = req.params;
      const { force = false } = req.query; // Optional force parameter
      const deletedBy = req.user.id;
      const deletedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      // Validate department ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(ApiError.badRequest('Invalid department ID format'));
      }

      // Check if department can be deleted
      const canDelete = await DepartmentService.canDeleteDepartmentSafe(id, deletedBy, deletedByRole);
      
      if (!canDelete.canDelete && !force) {
        return res.status(400).json({
          success: false,
          message: canDelete.reason,
          data: {
            blockers: canDelete.blockers,
            suggestions: canDelete.suggestions
          }
        });
      }

      await DepartmentService.deleteDepartment(id, deletedBy, deletedByRole, ipAddress);

      logger.info('Department deleted successfully', {
        departmentId: id,
        deletedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Department deleted successfully'
      });
    } catch (error) {
      logger.error('Delete department failed', {
        error: error.message,
        departmentId: req.params.id,
        deletedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/can-delete - Check if department can be deleted
  async checkDepartmentDeletion(req, res, next) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(ApiError.badRequest('Invalid department ID format'));
      }

      const result = await DepartmentService.canDeleteDepartmentSafe(
        id, 
        req.user.id, 
        req.user.role
      );

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Check department deletion failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/attendance-summary
  async getAttendanceSummary(req, res, next) {
    try {
      const { id } = req.params;
      const { startDate, endDate, period = '30' } = req.query;

      // First verify user can access this department
      await DepartmentService.getDepartmentById(id, req.user.id, req.user.role);

      // Set default date range if not provided
      let dateOptions = {};
      if (startDate && endDate) {
        dateOptions = { startDate, endDate };
      } else {
        // Default to last N days
        const days = parseInt(period) || 30;
        const endDateDefault = new Date();
        const startDateDefault = new Date();
        startDateDefault.setDate(startDateDefault.getDate() - days);
        
        dateOptions = {
          startDate: startDateDefault.toISOString(),
          endDate: endDateDefault.toISOString()
        };
      }

      const summary = await DepartmentService.getDepartmentAttendanceSummary(id, dateOptions);

      logger.info('Department attendance summary retrieved', {
        departmentId: id,
        requestedBy: req.user.id,
        period: dateOptions
      });

      res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      logger.error('Get department attendance summary failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/departments/stats - Get overall department statistics
  async getAllDepartmentStatistics(req, res, next) {
    try {
      const { timeframe = '30d' } = req.query;
      
      // Get overall department statistics
      const stats = await DepartmentService.getAllDepartmentStatistics(
        req.user.id,
        req.user.role,
        { timeframe }
      );

      res.status(200).json({
        success: true,
        data: {
          statistics: stats,
          timeframe,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Get all department statistics failed', {
        error: error.message,
        requestingUserId: req.user.id,
        timeframe: req.query.timeframe
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/stats - Get specific department statistics
  async getDepartmentStatistics(req, res, next) {
    try {
      const { id } = req.params;

      // Validate department ID
      if (!id) {
        return next(ApiError.badRequest('Department ID is required'));
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(ApiError.badRequest('Invalid department ID format'));
      }

      // Get department with statistics
      const department = await DepartmentService.getDepartmentById(
        id, 
        req.user.id, 
        req.user.role
      );

      if (!department) {
        return next(ApiError.notFound('Department not found'));
      }

      res.status(200).json({
        success: true,
        data: {
          departmentId: id,
          name: department.name,
          category: department.category,
          statistics: department.statistics,
          subDepartments: department.subDepartments,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Get department statistics failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/hierarchy
  async getDepartmentHierarchy(req, res, next) {
    try {
      const { includeStats = false } = req.query;
      
      // Get all departments that user can access
      const filters = {
        scopedAccess: true,
        currentUserRole: req.user.role,
        departmentIds: req.user.departmentIds
      };

      const options = {
        includeHierarchy: true,
        limit: 1000 // Get all for hierarchy
      };

      const result = await DepartmentService.getAllDepartments(filters, options);

      res.status(200).json({
        success: true,
        data: {
          hierarchy: result.departments,
          totalDepartments: result.pagination.totalDepartments
        }
      });
    } catch (error) {
      logger.error('Get department hierarchy failed', {
        error: error.message,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/departments/:id/transfer-members
  async transferMembers(req, res, next) {
    try {
      const { id } = req.params; // Target department
      const { memberIds, fromDepartmentId, reason } = req.body;

      if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
        return next(ApiError.badRequest('Member IDs are required'));
      }

      const transferredBy = req.user.id;
      const transferredByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      // Bulk transfer operation
      const results = {
        successful: [],
        failed: []
      };

      for (const memberId of memberIds) {
        try {
          // First remove from source department
          if (fromDepartmentId) {
            await DepartmentService.removeMemberFromDepartment(
              fromDepartmentId,
              memberId,
              transferredBy,
              transferredByRole,
              ipAddress
            );
          }

          // Then add to target department
          const addResult = await DepartmentService.addMembersToDepartment(
            id,
            [memberId],
            transferredBy,
            transferredByRole,
            ipAddress
          );

          if (addResult.successful.length > 0) {
            results.successful.push({
              memberId,
              name: addResult.successful[0].name
            });
          } else {
            results.failed.push({
              memberId,
              reason: addResult.failed[0]?.reason || 'Transfer failed'
            });
          }
        } catch (error) {
          results.failed.push({
            memberId,
            reason: error.message
          });
        }
      }

      logger.info('Member transfer completed', {
        targetDepartmentId: id,
        fromDepartmentId,
        transferredBy,
        successful: results.successful.length,
        failed: results.failed.length,
        reason,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: `${results.successful.length} members transferred successfully`,
        data: results
      });
    } catch (error) {
      logger.error('Transfer members failed', {
        error: error.message,
        targetDepartmentId: req.params.id,
        transferredBy: req.user.id,
        requestBody: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/departments/:id/assign-leader
  async assignLeader(req, res, next) {
    try {
      const { id } = req.params;
      const { userId, reason } = req.body;
      const assignedBy = req.user.id;
      const assignedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const department = await DepartmentService.assignDepartmentLeader(
        id,
        userId,
        assignedBy,
        assignedByRole,
        ipAddress
      );

      logger.info('Department leader assigned successfully', {
        departmentId: id,
        newLeaderId: userId,
        assignedBy,
        reason,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Department leader assigned successfully',
        data: { department }
      });
    } catch (error) {
      logger.error('Assign department leader failed', {
        error: error.message,
        departmentId: req.params.id,
        newLeaderId: req.body.userId,
        assignedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/departments/:id/events
  async getDepartmentEvents(req, res, next) {
    try {
      const { id } = req.params;
      const { page, limit, startDate, endDate, eventType, status } = req.query;

      // First verify user can access this department
      await DepartmentService.getDepartmentById(id, req.user.id, req.user.role);

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        startDate,
        endDate,
        eventType,
        status
      };

      const result = await DepartmentService.getDepartmentEvents(id, options);

      res.status(200).json({
        success: true,
        data: result.events,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get department events failed', {
        error: error.message,
        departmentId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/departments/:id/activate
  async activateDepartment(req, res, next) {
    try {
      const { id } = req.params;
      const activatedBy = req.user.id;
      const activatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const department = await DepartmentService.updateDepartment(
        id,
        { isActive: true },
        activatedBy,
        activatedByRole,
        ipAddress
      );

      logger.info('Department activated successfully', {
        departmentId: id,
        activatedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Department activated successfully',
        data: { department }
      });
    } catch (error) {
      logger.error('Activate department failed', {
        error: error.message,
        departmentId: req.params.id,
        activatedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/departments/:id/deactivate
  async deactivateDepartment(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const deactivatedBy = req.user.id;
      const deactivatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const department = await DepartmentService.updateDepartment(
        id,
        { isActive: false, deactivationReason: reason },
        deactivatedBy,
        deactivatedByRole,
        ipAddress
      );

      logger.info('Department deactivated successfully', {
        departmentId: id,
        deactivatedBy,
        reason,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Department deactivated successfully',
        data: { department }
      });
    } catch (error) {
      logger.error('Deactivate department failed', {
        error: error.message,
        departmentId: req.params.id,
        deactivatedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }
}

module.exports = new DepartmentController(); 
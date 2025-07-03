const UserService = require('../services/user.service');
const { validateInput } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const { USER_ROLES } = require('../utils/constants');
const logger = require('../utils/logger');

class UserController {
  // GET /api/v1/users
  async listUsers(req, res, next) {
    try {
      const { page, limit, sort, search, role, department, isActive, isVerified } = req.query;
      
      const filters = {
        scopedAccess: true,
        currentUserRole: req.user.role,
        departmentId: req.user.departmentId
      };

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        sort,
        search,
        role,
        department,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isVerified: isVerified !== undefined ? isVerified === 'true' : undefined
      };

      const result = await UserService.getAllUsers(filters, options);

      res.status(200).json({
        success: true,
        data: result.users,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('List users failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/users
  async createUser(req, res, next) {
    try {
      const { error } = validateInput.createUser.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const userData = req.body;
      const createdBy = req.user.id;
      const createdByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.createUser(userData, createdBy, createdByRole, ipAddress);

      logger.info('User created successfully', {
        createdUserId: user._id,
        createdBy,
        role: userData.role,
        ipAddress
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Create user failed', {
        error: error.message,
        createdBy: req.user.id,
        userData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/users/:id
  async getUser(req, res, next) {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      const requestingUserRole = req.user.role;

      const user = await UserService.getUserById(id, requestingUserId, requestingUserRole);

      res.status(200).json({
        success: true,
        data: { user }
      });
    } catch (error) {
      logger.error('Get user failed', {
        error: error.message,
        targetUserId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // PUT /api/v1/users/:id
  async updateUser(req, res, next) {
    try {
      const { error } = validateInput.updateUser.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = req.user.id;
      const updatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.updateUser(id, updateData, updatedBy, updatedByRole, ipAddress);

      logger.info('User updated successfully', {
        updatedUserId: id,
        updatedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'User updated successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Update user failed', {
        error: error.message,
        targetUserId: req.params.id,
        updatedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // DELETE /api/v1/users/:id
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      const deletedBy = req.user.id;
      const deletedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await UserService.deleteUser(id, deletedBy, deletedByRole, ipAddress);

      logger.info('User deleted successfully', {
        deletedUserId: id,
        deletedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error('Delete user failed', {
        error: error.message,
        targetUserId: req.params.id,
        deletedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/users/:id/role
  async assignRole(req, res, next) {
    try {
      const { error } = validateInput.assignRole.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const { id } = req.params;
      const { role } = req.body;
      const assignedBy = req.user.id;
      const assignedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.assignRole(id, role, assignedBy, assignedByRole, ipAddress);

      logger.info('Role assigned successfully', {
        targetUserId: id,
        newRole: role,
        assignedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'Role assigned successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Role assignment failed', {
        error: error.message,
        targetUserId: req.params.id,
        assignedBy: req.user.id,
        newRole: req.body.role,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/users/:id/attendance-history
  async getAttendanceHistory(req, res, next) {
    try {
      const { id } = req.params;
      const { page, limit, startDate, endDate, eventType } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        startDate,
        endDate,
        eventType
      };

      const result = await UserService.getUserAttendanceHistory(id, options);

      res.status(200).json({
        success: true,
        data: {
          attendance: result.attendance,
          statistics: result.statistics
        },
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get attendance history failed', {
        error: error.message,
        targetUserId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/users/bulk-import
  async bulkImport(req, res, next) {
    try {
      const { error } = validateInput.bulkImport.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const { users } = req.body;
      const importedBy = req.user.id;
      const importedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await UserService.bulkImportUsers(users, importedBy, importedByRole, ipAddress);

      logger.info('Bulk import completed', {
        total: result.total,
        successful: result.successful.length,
        failed: result.failed.length,
        importedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: `Bulk import completed. ${result.successful.length} successful, ${result.failed.length} failed.`,
        data: result
      });
    } catch (error) {
      logger.error('Bulk import failed', {
        error: error.message,
        importedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/users/bulk-export
  async bulkExport(req, res, next) {
    try {
      const { format = 'csv', filters } = req.query;
      
      // Get users based on filters
      const result = await UserService.getAllUsers(filters, { limit: 10000 }); // Large limit for export
      
      if (format === 'csv') {
        const csv = this.convertToCSV(result.users);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
        res.status(200).send(csv);
      } else {
        res.status(200).json({
          success: true,
          data: result.users,
          pagination: result.pagination
        });
      }
    } catch (error) {
      logger.error('Bulk export failed', {
        error: error.message,
        requestedBy: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/users/:id/role
  async getRole(req, res, next) {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      const requestingUserRole = req.user.role;

      const user = await UserService.getUserById(id, requestingUserId, requestingUserRole);

      // Return role-specific UI configuration
      const roleConfig = this.getRoleUIConfig(user.role);

      res.status(200).json({
        success: true,
        data: {
          role: user.role,
          permissions: roleConfig.permissions,
          navigation: roleConfig.navigation,
          features: roleConfig.features
        }
      });
    } catch (error) {
      logger.error('Get role failed', {
        error: error.message,
        targetUserId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/users/search
  async searchUsers(req, res, next) {
    try {
      const { search, role, department, isActive } = req.query;
      const filters = {
        search,
        role,
        department,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        scopedAccess: true,
        currentUserRole: req.user.role,
        departmentId: req.user.departmentId
      };

      const users = await UserService.searchUsers(filters);

      res.status(200).json({
        success: true,
        data: { users }
      });
    } catch (error) {
      logger.error('Search users failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/users/stats
  async getUserStats(req, res, next) {
    try {
      const stats = await UserService.getUserStats(req.user.role, req.user.departmentId);

      res.status(200).json({
        success: true,
        data: { stats }
      });
    } catch (error) {
      logger.error('Get user stats failed', {
        error: error.message,
        userId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/users/:id/activate
  async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      const activatedBy = req.user.id;
      const activatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.updateUser(
        id,
        { isActive: true },
        activatedBy,
        activatedByRole,
        ipAddress
      );

      logger.info('User activated successfully', {
        activatedUserId: id,
        activatedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'User activated successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Activate user failed', {
        error: error.message,
        targetUserId: req.params.id,
        activatedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/users/:id/deactivate
  async deactivateUser(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const deactivatedBy = req.user.id;
      const deactivatedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.updateUser(
        id,
        { isActive: false, deactivationReason: reason },
        deactivatedBy,
        deactivatedByRole,
        ipAddress
      );

      logger.info('User deactivated successfully', {
        deactivatedUserId: id,
        deactivatedBy,
        reason,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'User deactivated successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Deactivate user failed', {
        error: error.message,
        targetUserId: req.params.id,
        deactivatedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/users/:id/permissions
  async getPermissions(req, res, next) {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      const requestingUserRole = req.user.role;

      const permissions = await UserService.getUserPermissions(id, requestingUserId, requestingUserRole);

      res.status(200).json({
        success: true,
        data: { permissions }
      });
    } catch (error) {
      logger.error('Get user permissions failed', {
        error: error.message,
        targetUserId: req.params.id,
        requestingUserId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/users/:id/departments
  async addUserToDepartments(req, res, next) {
    try {
      const { id } = req.params;
      const { departmentIds } = req.body;
      const addedBy = req.user.id;
      const addedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.addUserToDepartments(id, departmentIds, addedBy, addedByRole, ipAddress);

      logger.info('User added to departments successfully', {
        userId: id,
        departmentIds,
        addedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'User added to departments successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Add user to departments failed', {
        error: error.message,
        targetUserId: req.params.id,
        departmentIds: req.body.departmentIds,
        addedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // DELETE /api/v1/users/:id/departments/:departmentId
  async removeUserFromDepartment(req, res, next) {
    try {
      const { id, departmentId } = req.params;
      const removedBy = req.user.id;
      const removedByRole = req.user.role;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const user = await UserService.removeUserFromDepartment(id, departmentId, removedBy, removedByRole, ipAddress);

      logger.info('User removed from department successfully', {
        userId: id,
        departmentId,
        removedBy,
        ipAddress
      });

      res.status(200).json({
        success: true,
        message: 'User removed from department successfully',
        data: { user }
      });
    } catch (error) {
      logger.error('Remove user from department failed', {
        error: error.message,
        targetUserId: req.params.id,
        departmentId: req.params.departmentId,
        removedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // Helper methods
  convertToCSV(users) {
    const headers = [
      'ID', 'Full Name', 'Phone Number', 'Email', 'Role', 
      'Department', 'Ministry', 'Is Active', 'Is Verified', 'Created At'
    ];
    
    const rows = users.map(user => [
      user._id,
      user.fullName,
      user.phoneNumber,
      user.email || '',
      user.role,
      user.departmentId?.name || '',
      user.ministryId?.name || '',
      user.isActive,
      user.isVerified,
      user.createdAt
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  getRoleUIConfig(role) {
    const configs = {
      [USER_ROLES.SUPER_ADMIN]: {
        permissions: ['*'],
        navigation: ['dashboard', 'users', 'departments', 'events', 'attendance', 'reports', 'settings'],
        features: ['user_management', 'org_structure', 'system_admin', 'full_analytics']
      },
      [USER_ROLES.SENIOR_PASTOR]: {
        permissions: ['view:all', 'report:all', 'analytics:all'],
        navigation: ['dashboard', 'analytics', 'reports', 'events', 'members'],
        features: ['church_analytics', 'leadership_reports', 'member_insights']
      },
      [USER_ROLES.ASSOCIATE_PASTOR]: {
        permissions: ['view:all', 'manage:roles', 'create:cross_events'],
        navigation: ['dashboard', 'users', 'events', 'departments', 'reports'],
        features: ['role_management', 'event_oversight', 'department_coordination']
      },
      [USER_ROLES.DEPARTMENT_LEADER]: {
        permissions: ['view:department', 'manage:department', 'create:department_events'],
        navigation: ['dashboard', 'my_department', 'events', 'members', 'reports'],
        features: ['department_management', 'member_oversight', 'department_events']
      },
      [USER_ROLES.CLOCKER]: {
        permissions: ['create:scoped_events', 'mark:attendance'],
        navigation: ['dashboard', 'my_events', 'attendance', 'reports'],
        features: ['scoped_events', 'attendance_marking', 'basic_reports']
      },
      [USER_ROLES.MEMBER]: {
        permissions: ['view:personal', 'update:profile'],
        navigation: ['dashboard', 'my_profile', 'my_attendance', 'events'],
        features: ['personal_profile', 'attendance_history', 'event_participation']
      }
    };

    return configs[role] || configs[USER_ROLES.MEMBER];
  }
}

const controller = new UserController();
module.exports = controller; 
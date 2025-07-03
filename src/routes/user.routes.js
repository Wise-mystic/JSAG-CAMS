const express = require('express');
const UserController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateRequest, validateQuery } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { userSchemas, querySchemas } = require('../utils/validators');
const { USER_ROLES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for user operations
const userCreationLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 user creations per window
  message: 'Too many user creation attempts, please try again later'
});

const bulkOperationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 bulk operations per hour
  message: 'Too many bulk operations, please try again later'
});

const roleAssignmentLimiter = rateLimiter({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 20, // 20 role assignments per window
  message: 'Too many role assignment attempts, please try again later'
});

// Apply authentication to all user routes
router.use(authenticate);

// GET /users - List users with filtering and pagination
router.get('/', 
  validateQuery(querySchemas.pagination),
  validateQuery(querySchemas.userFilters),
  authorize({
    permission: 'users.view_all',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR]
  }),
  UserController.listUsers
);

// POST /users - Create new user
router.post('/', 
  userCreationLimiter,
  validateRequest(userSchemas.create),
  authorize({
    permission: 'users.create',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    checkHierarchy: true
  }),
  UserController.createUser
);

// GET /users/export - Export users (bulk operation)
router.get('/export', 
  bulkOperationLimiter,
  validateQuery(querySchemas.userFilters),
  authorize({
    permission: 'users.export',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR]
  }),
  UserController.bulkExport
);

// POST /users/bulk-import - Import users in bulk
router.post('/bulk-import', 
  bulkOperationLimiter,
  authorize({
    permission: 'users.create',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    checkHierarchy: true
  }),
  UserController.bulkImport
);

// GET /users/search - Search users
router.get('/search',
  validateQuery(querySchemas.userFilters),
  authorize({
    permission: 'users.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR]
  }),
  UserController.searchUsers
);

// GET /users/stats - Get user statistics
router.get('/stats',
  authorize({
    permission: 'users.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR]
  }),
  UserController.getUserStats
);

// GET /users/:id - Get specific user
router.get('/:id', 
  authorize({
    permission: 'users.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
    checkOwnership: true
  }),
  UserController.getUser
);

// PUT /users/:id - Update user
router.put('/:id', 
  validateRequest(userSchemas.update),
  authorize({
    permission: 'users.update',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    checkHierarchy: true,
    checkOwnership: true
  }),
  UserController.updateUser
);

// DELETE /users/:id - Delete user (soft delete)
router.delete('/:id', 
  authorize({
    permission: 'users.delete',
    allowedRoles: [USER_ROLES.SUPER_ADMIN],
    checkHierarchy: true
  }),
  UserController.deleteUser
);

// POST /users/:id/role - Assign role to user
router.post('/:id/role', 
  roleAssignmentLimiter,
  validateRequest(Joi.object({
      role: Joi.string().valid(...Object.values(USER_ROLES)).required(),
      reason: Joi.string().max(200).optional()
  })),
  authorize({
    permission: 'users.assign_role',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    checkHierarchy: true
  }),
  UserController.assignRole
);

// GET /users/:id/role - Get user role information
router.get('/:id/role', 
  authorize({
    permission: 'users.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
    checkOwnership: true
  }),
  UserController.getRole
);

// GET /users/:id/attendance-history - Get user's attendance history
router.get('/:id/attendance-history', 
  validateQuery(querySchemas.dateRange),
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'attendance.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER],
    checkOwnership: true,
    checkDepartmentAccess: true
  }),
  UserController.getAttendanceHistory
);

// POST /users/:id/activate - Activate user account
router.post('/:id/activate', 
  authorize({
    permission: 'users.update',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR]
  }),
  UserController.activateUser
);

// POST /users/:id/deactivate - Deactivate user account
router.post('/:id/deactivate', 
  validateRequest(Joi.object({
      reason: Joi.string().max(200).required()
  })),
  authorize({
    permission: 'users.deactivate',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    checkHierarchy: true
  }),
  UserController.deactivateUser
);

// GET /users/:id/permissions - Get user's effective permissions
router.get('/:id/permissions', 
  authorize({
    permission: 'users.read',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    checkOwnership: true
  }),
  UserController.getPermissions
);

// POST /users/:id/departments - Add user to departments
router.post('/:id/departments', 
  validateRequest(Joi.object({
    departmentIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).min(1).required()
  })),
  authorize({
    permission: 'users.update',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    checkDepartmentAccess: true
  }),
  UserController.addUserToDepartments
);

// DELETE /users/:id/departments/:departmentId - Remove user from department
router.delete('/:id/departments/:departmentId', 
  authorize({
    permission: 'users.update',
    allowedRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    checkDepartmentAccess: true
  }),
  UserController.removeUserFromDepartment
);

module.exports = router; 
const express = require('express');
const controller = require('../controllers/department.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateRequest, validateQuery } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { departmentSchemas, querySchemas } = require('../utils/validators');
const { USER_ROLES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for department operations
const departmentCreationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 department creations per hour
  message: 'Too many department creation attempts, please try again later'
});

const memberManagementLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 member operations per window
  message: 'Too many member management operations, please try again later'
});

// Apply authentication to all department routes
router.use(authenticate);

// GET /departments - List all departments
router.get('/', 
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'departments:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.CLOCKER,
      USER_ROLES.MEMBER
    ]
  }),
  controller.listDepartments
);

// POST /departments - Create new department
router.post('/', 
  departmentCreationLimiter,
  validateRequest(departmentSchemas.create),
  authorize({
    permission: 'departments:create',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.createDepartment
);

// GET /departments/stats - Get department statistics
router.get('/stats',
  authorize({
    permission: 'departments:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.getDepartmentStatistics
);

// GET /departments/:id - Get specific department
router.get('/:id', 
  authorize({
    permission: 'departments:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.CLOCKER,
      USER_ROLES.MEMBER
    ],
    checkDepartmentAccess: true
  }),
  controller.getDepartment
);

// PUT /departments/:id - Update department
router.put('/:id', 
  validateRequest(departmentSchemas.update),
  authorize({
    permission: 'departments:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ],
    checkDepartmentAccess: true
  }),
  controller.updateDepartment
);

// DELETE /departments/:id - Delete department
router.delete('/:id', 
  authorize({
    permission: 'departments:delete',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.deleteDepartment
);

// GET /departments/:id/members - Get department members
router.get('/:id/members', 
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'departments:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true
  }),
  controller.getMembers
);

// POST /departments/:id/members - Add members to department
router.post('/:id/members', 
  memberManagementLimiter,
  validateRequest(Joi.object({
    userIds: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1)
      .max(50)
      .required(),
    sendNotification: Joi.boolean().default(true)
  })),
  authorize({
    permission: 'departments:manage_members',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true
  }),
  controller.addMembers
);

// DELETE /departments/:id/members/:userId - Remove member from department
router.delete('/:id/members/:userId', 
  memberManagementLimiter,
  authorize({
    permission: 'departments:manage_members',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true,
    checkHierarchy: true
  }),
  controller.removeMember
);

// GET /departments/:id/attendance-summary - Get department attendance summary
router.get('/:id/attendance-summary', 
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'attendance:reports',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true
  }),
  controller.getAttendanceSummary
);

// POST /departments/:id/assign-leader - Assign department leader
router.post('/:id/assign-leader',
  validateRequest(Joi.object({
    userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    reason: Joi.string().max(200).optional()
  })),
  authorize({
    permission: 'departments:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.assignLeader
);

// GET /departments/:id/events - Get department events
router.get('/:id/events',
  validateQuery(querySchemas.pagination),
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'events:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.MEMBER
    ],
    checkDepartmentAccess: true
  }),
  controller.getDepartmentEvents
);

// POST /departments/:id/activate - Activate department
router.post('/:id/activate',
  authorize({
    permission: 'departments:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.activateDepartment
);

// POST /departments/:id/deactivate - Deactivate department
router.post('/:id/deactivate',
  validateRequest(Joi.object({
    reason: Joi.string().max(200).required()
  })),
  authorize({
    permission: 'departments:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.deactivateDepartment
);

module.exports = router; 
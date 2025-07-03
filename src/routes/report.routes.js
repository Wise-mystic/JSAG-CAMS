const express = require('express');
const controller = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateQuery, validateRequest } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { querySchemas } = require('../utils/validators');
const { USER_ROLES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for report operations
const reportGenerationLimiter = rateLimiter({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 20, // 20 report generations per window
  message: 'Too many report generation attempts, please try again later'
});

const exportLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 exports per hour
  message: 'Too many export attempts, please try again later'
});

// Apply authentication to all report routes
router.use(authenticate);

// GET /reports/attendance-summary - Get attendance summary report
router.get('/attendance-summary', 
  validateQuery(querySchemas.dateRange),
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'reports:read',
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

// GET /reports/member-analytics - Get member analytics
router.get('/member-analytics', 
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'analytics:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.getMemberAnalytics
);

// GET /reports/department-performance - Get department performance
router.get('/department-performance', 
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'reports:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkDepartmentAccess: true
  }),
  controller.getDepartmentPerformance
);

// GET /reports/event-analytics - Get event analytics
router.get('/event-analytics', 
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'analytics:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.getEventAnalytics
);

// POST /reports/export - Export custom report
router.post('/export', 
  exportLimiter,
  validateRequest(Joi.object({
    reportType: Joi.string().valid(
      'attendance', 
      'members', 
      'events', 
      'departments', 
      'analytics'
    ).required(),
    format: Joi.string().valid('excel', 'csv', 'pdf').default('excel'),
    dateRange: Joi.object({
      startDate: Joi.date().required(),
      endDate: Joi.date().min(Joi.ref('startDate')).required()
    }).required(),
    filters: Joi.object({
      departments: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).optional(),
      eventTypes: Joi.array().items(Joi.string()).optional(),
      userRoles: Joi.array().items(Joi.string()).optional()
    }).optional()
  })),
  authorize({
    permission: 'reports:export',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.exportReport
);

// GET /reports/dashboard/:role - Get role-specific dashboard data
router.get('/dashboard/:role', 
  authorize({
    permission: 'reports:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.CLOCKER
    ],
    checkRoleAccess: true
  }),
  controller.getDashboard
);

// GET /reports/export/:reportId - Download exported report
router.get('/export/:reportId', 
  authorize({
    permission: 'reports:download',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkOwnership: true
  }),
  controller.downloadExport
);

// GET /reports/financial-summary - Get financial/tithe summary
router.get('/financial-summary',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'reports:financial',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.getComprehensiveSummary
);

// GET /reports/growth-trends - Get church growth trends
router.get('/growth-trends',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'analytics:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.getTrends
);

// GET /reports/ministry-performance - Get ministry performance
router.get('/ministry-performance',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'reports:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.comparePerformance
);

module.exports = router; 
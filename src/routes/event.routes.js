const express = require('express');
const controller = require('../controllers/event.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateRequest, validateQuery } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { eventSchemas, querySchemas } = require('../utils/validators');
const { USER_ROLES, EVENT_TYPES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for event operations
const eventCreationLimiter = rateLimiter({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 20, // 20 events per window
  message: 'Too many event creation attempts, please try again later'
});

const eventUpdateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 updates per window
  message: 'Too many event update attempts, please try again later'
});

const bulkOperationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 bulk operations per hour
  message: 'Too many bulk operations, please try again later'
});

// Apply authentication to all event routes
router.use(authenticate);

// GET /events - List events with filtering and pagination
router.get('/', 
  validateQuery(querySchemas.pagination),
  validateQuery(querySchemas.eventFilters),
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'events:read',
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
  controller.listEvents
);

// POST /events - Create new event
router.post('/', 
  eventCreationLimiter,
  validateRequest(eventSchemas.create),
  authorize({
    permission: 'events:create',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true
  }),
  controller.createEvent
);

// GET /events/upcoming - Get upcoming events
router.get('/upcoming',
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'events:read',
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
  controller.getUpcomingEvents
);

// GET /events/calendar - Get calendar view of events
router.get('/calendar',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'events:read',
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
  controller.getCalendarEvents
);

// GET /events/my-events - Get current user's events
router.get('/my-events',
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
      USER_ROLES.CLOCKER, 
      USER_ROLES.MEMBER
    ]
  }),
  controller.getMyEvents
);

// GET /events/stats - Get event statistics
router.get('/stats',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'events:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.getEventStats
);

// GET /events/:id - Get specific event
router.get('/:id', 
  authorize({
    permission: 'events:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER, 
      USER_ROLES.CLOCKER, 
      USER_ROLES.MEMBER
    ],
    checkEventAccess: true
  }),
  controller.getEvent
);

// PUT /events/:id - Update event
router.put('/:id', 
  eventUpdateLimiter,
  validateRequest(eventSchemas.update),
  authorize({
    permission: 'events:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkOwnership: true,
    checkDepartmentAccess: true
  }),
  controller.updateEvent
);

// PATCH /events/:id/status - Update event status
router.patch('/:id/status', 
  validateRequest(Joi.object({
    status: Joi.string().valid('draft', 'published', 'active', 'completed', 'cancelled').required(),
    reason: Joi.string().max(200).optional()
  })),
  authorize({
    permission: 'events:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkOwnership: true
  }),
  controller.updateStatus
);

// DELETE /events/:id - Delete event
router.delete('/:id', 
  authorize({
    permission: 'events:delete',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ],
    checkOwnership: true
  }),
  controller.deleteEvent
);

// POST /events/:id/participants - Add participants to event
router.post('/:id/participants', 
  validateRequest(Joi.object({
    userIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).min(1).required(),
    sendNotification: Joi.boolean().default(true)
  })),
  authorize({
    permission: 'events:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkOwnership: true,
    checkDepartmentAccess: true
  }),
  controller.addParticipants
);

// GET /events/:id/participants - Get event participants
router.get('/:id/participants', 
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'events:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER, 
      USER_ROLES.CLOCKER
    ],
    checkEventAccess: true
  }),
  controller.getParticipants
);

// GET /events/:id/attendance - Get event attendance
router.get('/:id/attendance', 
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'attendance:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER, 
      USER_ROLES.CLOCKER
    ],
    checkEventAccess: true
  }),
  controller.getAttendance
);

// POST /events/:id/duplicate - Duplicate event
router.post('/:id/duplicate', 
  eventCreationLimiter,
  validateRequest(Joi.object({
    title: Joi.string().min(3).max(100).optional(),
    startTime: Joi.date().min('now').required(),
    endTime: Joi.date().min(Joi.ref('startTime')).required(),
    copyParticipants: Joi.boolean().default(false)
  })),
  authorize({
    permission: 'events:create',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkOwnership: true,
    checkDepartmentAccess: true
  }),
  controller.duplicateEvent
);

// POST /events/:id/recur - Create recurring events
router.post('/:id/recur', 
  eventCreationLimiter,
  validateRequest(Joi.object({
    frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'yearly').required(),
    interval: Joi.number().integer().min(1).max(12).default(1),
    count: Joi.number().integer().min(1).max(52).optional(),
    endDate: Joi.date().min('now').optional(),
    daysOfWeek: Joi.array().items(Joi.number().integer().min(0).max(6)).optional()
  }).xor('count', 'endDate')),
  authorize({
    permission: 'events:create',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkOwnership: true
  }),
  controller.recurEvent
);

// POST /events/:id/cancel - Cancel event
router.post('/:id/cancel',
  validateRequest(Joi.object({
    reason: Joi.string().max(200).required(),
    notifyParticipants: Joi.boolean().default(true)
  })),
  authorize({
    permission: 'events:cancel',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ],
    checkOwnership: true
  }),
  controller.cancelEvent
);

// POST /events/:id/publish - Publish draft event
router.post('/:id/publish',
  authorize({
    permission: 'events:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ],
    checkOwnership: true
  }),
  controller.publishEvent
);

// POST /events/:id/close - Close event for attendance
router.post('/:id/close',
  authorize({
    permission: 'events:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.CLOCKER
    ],
    checkEventAccess: true
  }),
  controller.closeEvent
);

module.exports = router; 
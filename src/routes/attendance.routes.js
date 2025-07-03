const express = require('express');
const controller = require('../controllers/attendance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateRequest, validateQuery } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { attendanceSchemas, querySchemas } = require('../utils/validators');
const { USER_ROLES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for attendance operations
const attendanceMarkingLimiter = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // 100 attendance marks per window
  message: 'Too many attendance marking attempts, please try again later'
});

const bulkAttendanceLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 bulk operations per window
  message: 'Too many bulk attendance operations, please try again later'
});

// Apply authentication to all attendance routes
router.use(authenticate);

// GET /attendance/event/:eventId - Get event attendance
router.get('/event/:eventId', 
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
  controller.getEventAttendance
);

// POST /attendance/mark - Mark individual attendance
router.post('/mark', 
  attendanceMarkingLimiter,
  validateRequest(attendanceSchemas.mark),
  authorize({
    permission: 'attendance:mark',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER, 
      USER_ROLES.CLOCKER
    ],
    checkClockerAssignment: true,
    checkEventAccess: true
  }),
  controller.markAttendance
);

// POST /attendance/bulk-mark - Mark multiple attendance records
router.post('/bulk-mark', 
  bulkAttendanceLimiter,
  validateRequest(attendanceSchemas.bulkMark),
  authorize({
    permission: 'attendance:mark',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER, 
      USER_ROLES.CLOCKER
    ],
    checkClockerAssignment: true,
    checkEventAccess: true
  }),
  controller.bulkMarkAttendance
);

// PUT /attendance/:attendanceId - Update attendance record
router.put('/:attendanceId', 
  validateRequest(attendanceSchemas.mark),
  authorize({
    permission: 'attendance:update',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.CLOCKER
    ],
    checkClockerAssignment: true
  }),
  controller.updateAttendance
);

// POST /attendance/event/:eventId/close - Close event for attendance
router.post('/event/:eventId/close', 
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

// GET /attendance/member/:userId/history - Get member's attendance history
router.get('/member/:userId/history', 
  validateQuery(querySchemas.dateRange),
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'attendance:read',
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
  controller.getMemberHistory
);

// DELETE /attendance/:attendanceId - Delete attendance record
router.delete('/:attendanceId', 
  authorize({
    permission: 'attendance:delete',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.deleteAttendance
);

// POST /attendance/event/:eventId/bulk-import - Import attendance data
router.post('/event/:eventId/bulk-import', 
  bulkAttendanceLimiter,
  authorize({
    permission: 'attendance:mark',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.CLOCKER
    ],
    checkEventAccess: true
  }),
  controller.bulkImportAttendance
);

// GET /attendance/stats - Get attendance statistics
router.get('/stats',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'attendance:reports',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.getAttendanceStats
);

// GET /attendance/export - Export attendance data
router.get('/export',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'attendance:export',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.exportAttendance
);

module.exports = router; 
const express = require('express');
const controller = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { validateRequest, validateQuery } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { querySchemas } = require('../utils/validators');
const { USER_ROLES } = require('../utils/constants');
const Joi = require('joi');
const router = express.Router();

// Rate limiters for notification operations
const notificationSendLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 notifications per hour
  message: 'Too many notification sending attempts, please try again later'
});

const bulkNotificationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 bulk notifications per hour
  message: 'Too many bulk notification attempts, please try again later'
});

const templateCreationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 template creations per hour
  message: 'Too many template creation attempts, please try again later'
});

// Apply authentication to all notification routes
router.use(authenticate);

// POST /notifications/send - Send individual notification
router.post('/send', 
  notificationSendLimiter,
  validateRequest({
    body: Joi.object({
      recipients: Joi.array()
        .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .min(1)
        .max(50)
        .required(),
      type: Joi.string()
        .valid('sms', 'email', 'push', 'in-app')
        .required(),
      subject: Joi.string()
        .max(100)
        .when('type', {
          is: Joi.valid('email', 'push'),
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
      message: Joi.string()
        .min(1)
        .max(1000)
        .required(),
      templateId: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional(),
      variables: Joi.object().optional(),
      priority: Joi.string()
        .valid('low', 'normal', 'high', 'urgent')
        .default('normal'),
      scheduleFor: Joi.date()
        .min('now')
        .optional()
    })
  }),
  authorize({
    permission: 'notifications:send',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkDepartmentAccess: true
  }),
  controller.send
);

// POST /notifications/schedule - Schedule notification
router.post('/schedule', 
  notificationSendLimiter,
  validateRequest({
    body: Joi.object({
      recipients: Joi.array()
        .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .min(1)
        .max(100)
        .required(),
      type: Joi.string()
        .valid('sms', 'email', 'push', 'in-app')
        .required(),
      subject: Joi.string()
        .max(100)
        .optional(),
      message: Joi.string()
        .min(1)
        .max(1000)
        .required(),
      scheduleFor: Joi.date()
        .min('now')
        .required(),
      templateId: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional(),
      variables: Joi.object().optional(),
      recurrence: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly').required(),
        interval: Joi.number().integer().min(1).max(12).default(1),
        endDate: Joi.date().min(Joi.ref('scheduleFor')).optional()
      }).optional()
    })
  }),
  authorize({
    permission: 'notifications:schedule',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.schedule
);

// GET /notifications/templates - Get notification templates
router.get('/templates', 
  validateQuery(querySchemas.pagination),
  authorize({
    permission: 'notifications:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ]
  }),
  controller.getTemplates
);

// POST /notifications/templates - Create notification template
router.post('/templates', 
  templateCreationLimiter,
  validateRequest({
    body: Joi.object({
      name: Joi.string()
        .min(3)
        .max(50)
        .required(),
      description: Joi.string()
        .max(200)
        .optional(),
      type: Joi.string()
        .valid('sms', 'email', 'push', 'in-app')
        .required(),
      subject: Joi.string()
        .max(100)
        .when('type', {
          is: Joi.valid('email', 'push'),
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
      content: Joi.string()
        .min(1)
        .max(2000)
        .required(),
      variables: Joi.array()
        .items(Joi.string())
        .optional(),
      category: Joi.string()
        .valid('event', 'announcement', 'reminder', 'welcome', 'alert', 'prayer')
        .required(),
      isActive: Joi.boolean()
        .default(true)
    })
  }),
  authorize({
    permission: 'notifications:create_template',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.createTemplate
);

// GET /notifications/delivery-status/:id - Get delivery status
router.get('/delivery-status/:id', 
  authorize({
    permission: 'notifications:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER
    ],
    checkOwnership: true
  }),
  controller.getDeliveryStatus
);

// POST /notifications/bulk-send - Send bulk notifications
router.post('/bulk-send', 
  bulkNotificationLimiter,
  validateRequest({
    body: Joi.object({
      targetGroups: Joi.object({
        departments: Joi.array()
          .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
          .optional(),
        ministries: Joi.array()
          .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
          .optional(),
        prayerTribes: Joi.array()
          .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
          .optional(),
        roles: Joi.array()
          .items(Joi.string().valid(...Object.values(USER_ROLES)))
          .optional(),
        specificUsers: Joi.array()
          .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
          .optional()
      }).min(1).required(),
      type: Joi.string()
        .valid('sms', 'email', 'push', 'in-app')
        .required(),
      subject: Joi.string()
        .max(100)
        .optional(),
      message: Joi.string()
        .min(1)
        .max(1000)
        .required(),
      templateId: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional(),
      variables: Joi.object().optional(),
      priority: Joi.string()
        .valid('low', 'normal', 'high', 'urgent')
        .default('normal'),
      scheduleFor: Joi.date()
        .min('now')
        .optional()
    })
  }),
  authorize({
    permission: 'notifications:bulk_send',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ],
    checkDepartmentAccess: true
  }),
  controller.bulkSend
);

// GET /notifications/history - Get notification history
router.get('/history',
  validateQuery(querySchemas.pagination),
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'notifications:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR
    ]
  }),
  controller.getNotificationHistory
);

// GET /notifications/stats - Get notification statistics
router.get('/stats',
  validateQuery(querySchemas.dateRange),
  authorize({
    permission: 'notifications:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ]
  }),
  controller.getNotificationStats
);

// PUT /notifications/templates/:id - Update template
router.put('/templates/:id',
  validateRequest({
    body: Joi.object({
      name: Joi.string().min(3).max(50).optional(),
      description: Joi.string().max(200).optional(),
      content: Joi.string().min(1).max(2000).optional(),
      variables: Joi.array().items(Joi.string()).optional(),
      isActive: Joi.boolean().optional()
    })
  }),
  authorize({
    permission: 'notifications:update_template',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR
    ],
    checkOwnership: true
  }),
  controller.updateTemplate
);

// DELETE /notifications/templates/:id - Delete template
router.delete('/templates/:id',
  authorize({
    permission: 'notifications:delete_template',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ],
    checkOwnership: true
  }),
  controller.deleteTemplate
);

// POST /notifications/test - Test notification
router.post('/test',
  validateRequest({
    body: Joi.object({
      type: Joi.string().valid('sms', 'email').required(),
      recipient: Joi.string().required(),
      message: Joi.string().min(1).max(200).required()
    })
  }),
  authorize({
    permission: 'notifications:test',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR
    ]
  }),
  controller.testNotification
);

module.exports = router; 
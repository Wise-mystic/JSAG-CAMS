const Joi = require('joi');
const { ApiError } = require('./error.middleware');
const { ERROR_CODES } = require('../utils/constants');

// Validation middleware factory
const validate = (schema) => {
  if (!schema || typeof schema.validate !== 'function') {
    throw new Error('Invalid schema provided to validation middleware');
  }

  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false, // Return all errors, not just the first one
      allowUnknown: true, // Allow unknown keys
      stripUnknown: false, // Keep unknown keys
    };
    
    const { error, value } = schema.validate(req.body, validationOptions);
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      
      return next(ApiError.badRequest(
        'Validation failed',
        ERROR_CODES.VALIDATION_ERROR,
        errors
      ));
    }
    
    // Replace request body with validated value
    req.body = value;
    next();
  };
};

// Enhanced validation middleware that can handle multiple parts of the request
const validateRequest = (schemas) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    };

    // If schemas is a Joi schema object with validate method, use it directly for body validation
    if (schemas && typeof schemas.validate === 'function') {
      const { error, value } = schemas.validate(req.body, validationOptions);
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        
        return next(ApiError.badRequest(
          'Validation failed',
          ERROR_CODES.VALIDATION_ERROR,
          errors
        ));
      }
      
      req.body = value;
      return next();
    }

    // Otherwise, expect an object with keys for different parts of the request
    const { body, query, params } = schemas || {};
    
    if (body) {
      const { error, value } = body.validate(req.body, validationOptions);
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        
        return next(ApiError.badRequest(
          'Validation failed',
          ERROR_CODES.VALIDATION_ERROR,
          errors
        ));
      }
      
      req.body = value;
    }
    
    if (query) {
      const { error, value } = query.validate(req.query, validationOptions);
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        
        return next(ApiError.badRequest(
          'Invalid query parameters',
          ERROR_CODES.VALIDATION_ERROR,
          errors
        ));
      }
      
      req.query = value;
    }
    
    if (params) {
      const { error, value } = params.validate(req.params, validationOptions);
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        
        return next(ApiError.badRequest(
          'Invalid URL parameters',
          ERROR_CODES.VALIDATION_ERROR,
          errors
        ));
      }
      
      req.params = value;
    }
    
    next();
  };
};

// Validate query parameters
const validateQuery = (schema) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    };
    
    const { error, value } = schema.validate(req.query, validationOptions);
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      
      return next(ApiError.badRequest(
        'Invalid query parameters',
        ERROR_CODES.VALIDATION_ERROR,
        errors
      ));
    }
    
    req.query = value;
    next();
  };
};

// Validate URL parameters
const validateParams = (schema) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: false,
    };
    
    const { error, value } = schema.validate(req.params, validationOptions);
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      
      return next(ApiError.badRequest(
        'Invalid URL parameters',
        ERROR_CODES.VALIDATION_ERROR,
        errors
      ));
    }
    
    req.params = value;
    next();
  };
};

// Common validation schemas
const commonSchemas = {
  // MongoDB ObjectId
  objectId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow(null).message('Invalid ID format'),
  
  // Phone number (international format)
  phoneNumber: Joi.string()
    .pattern(/^(\+\d{1,3}[- ]?)?\d{10}$/)
    .message('Invalid phone number format'),
  
  // Email
  email: Joi.string().email().lowercase().trim(),
  
  // Password
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .message('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  
  // Sorting
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'name', 'email', 'role').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  
  // Date range
  dateRange: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso().greater(Joi.ref('from')),
  }),
};

// Validation schemas for different resources
const schemas = {
  // Auth schemas
  auth: {
    register: Joi.object({
      fullName: Joi.string().min(2).max(100).required(),
      phoneNumber: commonSchemas.phoneNumber.required(),
      email: commonSchemas.email.optional(),
      password: commonSchemas.password.required(),
    }),
    
    login: Joi.object({
      phoneNumber: commonSchemas.phoneNumber.required(),
      password: Joi.string().required(),
    }),
    
    verifyOTP: Joi.object({
      phoneNumber: commonSchemas.phoneNumber.required(),
      otp: Joi.string().length(6).pattern(/^\d+$/).required(),
    }),
    
    refreshToken: Joi.object({
      refreshToken: Joi.string().required(),
    }),
    
    forgotPassword: Joi.object({
      phoneNumber: commonSchemas.phoneNumber.required(),
    }),
    
    resetPassword: Joi.object({
      phoneNumber: commonSchemas.phoneNumber.required(),
      otp: Joi.string().length(6).pattern(/^\d+$/).required(),
      newPassword: commonSchemas.password.required(),
    }),
    
    changePassword: Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: commonSchemas.password.required(),
    }),
    
    completePasswordReset: Joi.object({
      resetToken: Joi.string().required(),
      newPassword: commonSchemas.password.required(),
      confirmPassword: Joi.any().valid(Joi.ref('newPassword')).required()
        .messages({ 'any.only': 'Passwords do not match' }),
    }),
    
    verifyPasswordResetSession: Joi.object({
      resetToken: Joi.string().required(),
    }),
    
    completeSessionPasswordReset: Joi.object({
      sessionToken: Joi.string().required(),
      newPassword: commonSchemas.password.required(),
      confirmPassword: Joi.any().valid(Joi.ref('newPassword')).required()
        .messages({ 'any.only': 'Passwords do not match' }),
    }),
  },
  
  // User schemas
  user: {
    create: Joi.object({
      fullName: Joi.string().min(2).max(100).required(),
      phoneNumber: commonSchemas.phoneNumber.required(),
      email: commonSchemas.email.optional(),
      password: commonSchemas.password.required(),
      role: Joi.string().valid(...Object.values(require('../utils/constants').USER_ROLES)).required(),
      departmentIds: Joi.array().items(commonSchemas.objectId).min(1).required(),
      ministryId: commonSchemas.objectId.optional(),
    }),
    
    update: Joi.object({
      fullName: Joi.string().min(2).max(100).optional(),
      email: commonSchemas.email.optional(),
      departmentIds: Joi.array().items(commonSchemas.objectId).min(1).optional(),
      ministryId: commonSchemas.objectId.optional().allow(null),
      isActive: Joi.boolean().optional(),
    }),
    
    assignRole: Joi.object({
      role: Joi.string().valid(...Object.values(require('../utils/constants').USER_ROLES)).required(),
    }),
    
    query: Joi.object({
      page: commonSchemas.page,
      limit: commonSchemas.limit,
      sortBy: commonSchemas.sortBy,
      sortOrder: commonSchemas.sortOrder,
      role: Joi.string().valid(...Object.values(require('../utils/constants').USER_ROLES)).optional(),
      departmentIds: Joi.array().items(commonSchemas.objectId).optional(),
      isActive: Joi.boolean().optional(),
      search: Joi.string().optional(),
    }),
  },
  
  // Department schemas
  department: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(500).optional(),
      category: Joi.string().valid(...Object.values(require('../utils/constants').DEPARTMENT_CATEGORIES)).required(),
      leaderId: commonSchemas.objectId.optional(),
      parentDepartmentId: commonSchemas.objectId.optional(),
      allowsOverlap: Joi.boolean().default(true),
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(500).optional(),
      leaderId: commonSchemas.objectId.optional().allow(null),
      isActive: Joi.boolean().optional(),
      settings: Joi.object({
        requiresApproval: Joi.boolean().optional(),
        maxMembers: Joi.number().integer().min(1).optional().allow(null),
      }).optional(),
    }),
    
    addMember: Joi.object({
      userIds: Joi.array().items(commonSchemas.objectId).min(1).required(),
      sendNotification: Joi.boolean().default(true)
    }),
  },
  
  // Event schemas
  event: {
    create: Joi.object({
      title: Joi.string().max(200).default('Untitled Event'),
      description: Joi.string().max(1000).default(''),
      eventType: Joi.string().valid(...Object.values(require('../utils/constants').EVENT_TYPES)).default('meeting'),
      startTime: Joi.date().iso().default(() => new Date(Date.now() + 24 * 60 * 60 * 1000)),
      endTime: Joi.date().iso().default(() => new Date(Date.now() + 25 * 60 * 60 * 1000)),
      location: Joi.object({
        name: Joi.string().default(''),
        address: Joi.string().default(''),
        coordinates: Joi.object({
          latitude: Joi.number().min(-90).max(90).default(null),
          longitude: Joi.number().min(-180).max(180).default(null),
        }).default({}),
      }).default({}),
      isRecurring: Joi.boolean().default(false),
      recurringPattern: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'bi-weekly', 'monthly').default('weekly'),
        interval: Joi.number().integer().min(1).default(1),
        daysOfWeek: Joi.array().items(Joi.string().valid('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')).default([]),
        endDate: Joi.date().iso().optional(),
        exceptions: Joi.array().items(Joi.date().iso()).default([]),
      }).default({}),
      maxParticipants: Joi.number().integer().min(1).default(null).allow(null),
      requiresRegistration: Joi.boolean().default(false),
      autoCloseAfterHours: Joi.number().integer().min(1).default(3),
      departmentId: commonSchemas.objectId.optional().allow(null),
      ministryId: commonSchemas.objectId.optional().allow(null),
      prayerTribeId: commonSchemas.objectId.optional().allow(null),
      assignedClockerId: commonSchemas.objectId.optional().allow(null),
      requiresAttendance: Joi.boolean().default(false),
      isPublic: Joi.boolean().default(false),
      sendReminders: Joi.boolean().default(true),
      reminderTimes: Joi.array().items(Joi.number().integer().min(1)).default([1440, 60]),
      tags: Joi.array().items(Joi.string()).default([]),
      settings: Joi.object({
        requiresRSVP: Joi.boolean().default(false),
        maxParticipants: Joi.number().integer().min(1).default(null).allow(null),
        allowWalkIns: Joi.boolean().default(true),
        sendReminders: Joi.boolean().default(true),
        reminderTimes: Joi.array().items(Joi.number().integer().min(1)).default([1440, 60]),
      }).default({}),
      targetAudience: Joi.string().valid(...Object.values(require('../utils/constants').TARGET_AUDIENCE)).default('all').optional(),
      targetIds: Joi.array().items(commonSchemas.objectId).default([]),
    }).options({ 
      allowUnknown: true, 
      stripUnknown: false,
      presence: 'optional' 
    }),
    
    update: Joi.object({
      title: Joi.string().min(3).max(200).optional(),
      description: Joi.string().max(1000).optional(),
      startTime: Joi.date().iso().optional(),
      endTime: Joi.date().iso().greater(Joi.ref('startTime')).optional(),
      location: Joi.object({
        name: Joi.string().optional(),
        address: Joi.string().optional(),
        coordinates: Joi.object({
          latitude: Joi.number().min(-90).max(90).optional(),
          longitude: Joi.number().min(-180).max(180).optional()
        }).optional()
      }).optional(),
      status: Joi.string().valid(...Object.values(require('../utils/constants').EVENT_STATUS)).optional(),
      assignedClockerId: commonSchemas.objectId.optional().allow(null),
      isPublic: Joi.boolean().optional(),
      sendReminders: Joi.boolean().optional(),
      maxParticipants: Joi.number().integer().min(1).optional().allow(null),
      tags: Joi.array().items(Joi.string()).optional(),
      settings: Joi.object({
        requiresRSVP: Joi.boolean().optional(),
        maxParticipants: Joi.number().integer().min(1).optional().allow(null),
        allowWalkIns: Joi.boolean().optional(),
        sendReminders: Joi.boolean().optional(),
        reminderTimes: Joi.array().items(Joi.number().integer().min(1)).optional()
      }).optional()
    }).options({
      allowUnknown: true,
      stripUnknown: false
    }),
    
    query: Joi.object({
      page: commonSchemas.page,
      limit: commonSchemas.limit,
      eventType: Joi.string().valid(...Object.values(require('../utils/constants').EVENT_TYPES)).optional(),
      status: Joi.string().valid(...Object.values(require('../utils/constants').EVENT_STATUS)).optional(),
      departmentId: commonSchemas.objectId.optional(),
      dateRange: commonSchemas.dateRange.optional(),
    }),
  },
  
  // Attendance schemas
  attendance: {
    mark: Joi.object({
      event: commonSchemas.objectId.required(),
      user: commonSchemas.objectId.required(),
      status: Joi.string().valid(...Object.values(require('../utils/constants').ATTENDANCE_STATUS)).required(),
      notes: Joi.string().max(500).optional(),
      location: Joi.object({
        name: Joi.string().optional(),
        coordinates: Joi.object({
          latitude: Joi.number().min(-90).max(90).optional(),
          longitude: Joi.number().min(-180).max(180).optional()
        }).optional()
      }).optional()
    }),
    
    bulkMark: Joi.object({
      event: commonSchemas.objectId.required(),
      attendanceRecords: Joi.array().items(
        Joi.object({
          user: commonSchemas.objectId.required(),
          status: Joi.string().valid(...Object.values(require('../utils/constants').ATTENDANCE_STATUS)).required(),
          notes: Joi.string().max(500).optional(),
          location: Joi.object({
            name: Joi.string().optional(),
            coordinates: Joi.object({
              latitude: Joi.number().min(-90).max(90).optional(),
              longitude: Joi.number().min(-180).max(180).optional()
            }).optional()
          }).optional()
        })
      ).min(1).required(),
    }),
    
    update: Joi.object({
      event: commonSchemas.objectId.optional(),
      user: commonSchemas.objectId.optional(),
      status: Joi.string().valid(...Object.values(require('../utils/constants').ATTENDANCE_STATUS)).optional(),
      notes: Joi.string().max(500).optional(),
      location: Joi.object({
        name: Joi.string().optional(),
        coordinates: Joi.object({
          latitude: Joi.number().min(-90).max(90).optional(),
          longitude: Joi.number().min(-180).max(180).optional()
        }).optional()
      }).optional()
    }),
  },
  
  // Common ID validation
  id: Joi.object({
    id: commonSchemas.objectId.required(),
  }),
};

// Helper object for easier access in controllers
const validateInput = {
  registration: schemas.auth.register,
  login: schemas.auth.login,
  otpVerification: schemas.auth.verifyOTP,
  forgotPassword: schemas.auth.forgotPassword,
  resetPassword: schemas.auth.resetPassword,
  changePassword: schemas.auth.changePassword,
  resendOTP: schemas.auth.forgotPassword, // Same schema as forgot password
  createUser: schemas.user.create,
  updateUser: schemas.user.update,
  assignRole: schemas.user.assignRole,
  bulkImport: Joi.object({
    users: Joi.array().items(schemas.user.create).min(1).required()
  })
};

module.exports = {
  validate,
  validateRequest,
  validateQuery,
  validateParams,
  schemas,
  commonSchemas,
  validateInput
}; 
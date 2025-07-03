// Validators
// Custom Joi validation rules and helpers

const Joi = require('joi');
const { USER_ROLES, EVENT_TYPES, ATTENDANCE_STATUS, DEPARTMENTS, VALIDATION } = require('./constants');

// Custom validation helpers
const customValidators = {
  /**
   * Ghana phone number validator
   */
  ghanaPhone: (value, helpers) => {
    // Remove all non-digit characters
    const cleaned = value.replace(/\D/g, '');
    
    // Valid Ghana number patterns
    const patterns = [
      /^233[0-9]{9}$/, // +233 format
      /^0[0-9]{9}$/,   // 0 prefix format
      /^[0-9]{9}$/     // 9-digit format
    ];
    
    const isValid = patterns.some(pattern => pattern.test(cleaned));
    
    if (!isValid) {
      return helpers.error('any.invalid', { 
        message: 'Invalid Ghana phone number format' 
      });
    }
    
    return value;
  },

  /**
   * Church name validator
   */
  churchName: (value, helpers) => {
    // Should contain common church words
    const churchWords = ['church', 'chapel', 'assembly', 'ministry', 'baptist', 'methodist', 'pentecostal', 'catholic', 'presbyterian'];
    const lowerValue = value.toLowerCase();
    
    const hasChurchWord = churchWords.some(word => lowerValue.includes(word));
    
    if (!hasChurchWord && value.length > 10) {
      return helpers.message('Name should contain church-related words or be descriptive');
    }
    
    return value;
  },

  /**
   * Event time validator (church-appropriate times)
   */
  churchEventTime: (value, helpers) => {
    const hour = new Date(value).getHours();
    
    // Church events typically happen between 5 AM and 11 PM
    if (hour < 5 || hour > 23) {
      return helpers.error('any.invalid', {
        message: 'Event time should be between 5 AM and 11 PM'
      });
    }
    
    return value;
  },

  /**
   * Department code validator
   */
  departmentCode: (value, helpers) => {
    // Department codes should be 2-5 characters, uppercase letters/numbers
    const codeRegex = /^[A-Z0-9]{2,5}$/;
    
    if (!codeRegex.test(value)) {
      return helpers.error('any.invalid', {
        message: 'Department code must be 2-5 uppercase letters/numbers'
      });
    }
    
    return value;
  },

  /**
   * Password strength validator for church system
   */
  churchPassword: (value, helpers) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasNumbers = /\d/.test(value);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);
    
    if (value.length < minLength) {
      return helpers.error('any.invalid', {
        message: `Password must be at least ${minLength} characters long`
      });
    }
    
    const strengthChecks = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar];
    const passedChecks = strengthChecks.filter(Boolean).length;
    
    if (passedChecks < 3) {
      return helpers.error('any.invalid', {
        message: 'Password must contain at least 3 of: uppercase, lowercase, numbers, special characters'
      });
    }
    
    return value;
  },

  /**
   * Event duration validator
   */
  eventDuration: (value, helpers) => {
    const { startTime, endTime } = value;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationHours = (end - start) / (1000 * 60 * 60);
    
    if (durationHours < 0.5) {
      return helpers.error('any.invalid', {
        message: 'Event must be at least 30 minutes long'
      });
    }
    
    if (durationHours > 12) {
      return helpers.error('any.invalid', {
        message: 'Event cannot be longer than 12 hours'
      });
    }
    
    return value;
  }
};

// User validation schemas
const userSchemas = {
  create: Joi.object({
    fullName: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .pattern(/^[a-zA-Z\s]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Full name should only contain letters and spaces'
      }),
    
    phoneNumber: Joi.string()
      .custom(customValidators.ghanaPhone)
      .required(),
    
    email: Joi.string()
      .email()
      .optional()
      .allow(null, ''),
    
    password: Joi.string()
      .custom(customValidators.churchPassword)
      .required(),
    
    role: Joi.string()
      .valid(...Object.values(USER_ROLES))
      .required(),
    
    departmentIds: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1)
      .optional(),

    ministryId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    prayerTribeId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    dateOfBirth: Joi.date()
      .max('now')
      .min('1900-01-01')
      .optional(),
    
    address: Joi.object({
      street: Joi.string().max(100).optional(),
      city: Joi.string().max(50).optional(),
      region: Joi.string().max(50).optional(),
      country: Joi.string().default('Ghana')
    }).optional(),
    
    emergencyContact: Joi.object({
      name: Joi.string().max(100).optional(),
      phone: Joi.string().custom(customValidators.ghanaPhone).optional(),
      relationship: Joi.string().max(50).optional()
    }).optional(),
    
    clockerAssignments: Joi.array()
      .items(
        Joi.object({
          department: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
          ministry: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
          prayerTribe: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
          assignedBy: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
          assignedAt: Joi.date().default(Date.now)
        })
      )
      .when('role', {
        is: USER_ROLES.CLOCKER,
        then: Joi.required(),
        otherwise: Joi.forbidden()
      })
  }),

  update: Joi.object({
    fullName: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .pattern(/^[a-zA-Z\s]+$/)
      .optional()
      .messages({
        'string.pattern.base': 'Full name should only contain letters and spaces'
      }),
    
    email: Joi.string()
      .email()
      .optional()
      .allow(null, ''),
    
    role: Joi.string()
      .valid(...Object.values(USER_ROLES))
      .optional(),
    
    departmentIds: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1)
      .optional(),
    
    ministryId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    isActive: Joi.boolean().optional(),
    
    address: Joi.object({
      street: Joi.string().max(100).optional(),
      city: Joi.string().max(50).optional(),
      region: Joi.string().max(50).optional(),
      country: Joi.string().optional()
    }).optional(),
    
    emergencyContact: Joi.object({
      name: Joi.string().max(100).optional(),
      phone: Joi.string().custom(customValidators.ghanaPhone).optional(),
      relationship: Joi.string().max(50).optional()
    }).optional()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .custom(customValidators.churchPassword)
      .required(),
    confirmPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'Passwords do not match'
      })
  })
};

// Event validation schemas
const eventSchemas = {
  create: Joi.object({
    title: Joi.string()
      .trim()
      .min(3)
      .max(100)
      .required(),
    
    description: Joi.string()
      .trim()
      .max(500)
      .optional(),
    
    type: Joi.string()
      .valid(...Object.values(EVENT_TYPES))
      .required(),
    
    startTime: Joi.date()
      .min('now')
      .custom(customValidators.churchEventTime)
      .required(),
    
    endTime: Joi.date()
      .min(Joi.ref('startTime'))
      .required(),
    
    location: Joi.string()
      .trim()
      .max(100)
      .optional(),
    
    targetDepartments: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .min(1)
      .optional(),
    
    targetMinistries: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .optional(),
    
    targetPrayerTribes: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .optional(),
    
    isRecurring: Joi.boolean().default(false),
    
    recurrencePattern: Joi.object({
      frequency: Joi.string()
        .valid('daily', 'weekly', 'monthly', 'yearly')
        .required(),
      interval: Joi.number().integer().min(1).max(12).default(1),
      daysOfWeek: Joi.array()
        .items(Joi.number().integer().min(0).max(6))
        .when('frequency', {
          is: 'weekly',
          then: Joi.required(),
          otherwise: Joi.forbidden()
        }),
      endDate: Joi.date().min(Joi.ref('...startTime')).optional()
    }).when('isRecurring', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    
    requiresAttendance: Joi.boolean().default(true),
    
    maxParticipants: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .optional(),
    
    isPublic: Joi.boolean().default(true),
    
    sendReminders: Joi.boolean().default(true),
    
    autoClose: Joi.boolean().default(true)
  }).custom(customValidators.eventDuration),

  update: Joi.object({
    title: Joi.string()
      .trim()
      .min(3)
      .max(100)
      .optional(),
    
    description: Joi.string()
      .trim()
      .max(500)
      .optional(),
    
    startTime: Joi.date()
      .min('now')
      .custom(customValidators.churchEventTime)
      .optional(),
    
    endTime: Joi.date()
      .min(Joi.ref('startTime'))
      .optional(),
    
    location: Joi.string()
      .trim()
      .max(100)
      .optional(),
    
    targetDepartments: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .optional(),
    
    maxParticipants: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .optional(),
    
    isPublic: Joi.boolean().optional(),
    
    sendReminders: Joi.boolean().optional(),
    
    status: Joi.string()
      .valid('draft', 'published', 'active', 'completed', 'cancelled')
      .optional()
  })
};

// Department validation schemas
const departmentSchemas = {
  create: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .required(),
    
    code: Joi.string()
      .custom(customValidators.departmentCode)
      .required(),
    
    description: Joi.string()
      .trim()
      .max(200)
      .optional(),
    
    parentDepartment: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    leader: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    mutuallyExclusive: Joi.array()
      .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
      .optional(),
    
    settings: Joi.object({
      requiresApproval: Joi.boolean().default(false),
      maxMembers: Joi.number().integer().min(1).optional(),
      allowMultipleMembership: Joi.boolean().default(true)
    }).optional()
  }),

  update: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .optional(),
    
    description: Joi.string()
      .trim()
      .max(200)
      .optional(),
    
    leader: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional(),
    
    isActive: Joi.boolean().optional(),
    
    settings: Joi.object({
      requiresApproval: Joi.boolean().optional(),
      maxMembers: Joi.number().integer().min(1).optional(),
      allowMultipleMembership: Joi.boolean().optional()
    }).optional()
  })
};

// Attendance validation schemas
const attendanceSchemas = {
  mark: Joi.object({
    event: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    user: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    status: Joi.string()
      .valid(...Object.values(ATTENDANCE_STATUS))
      .required(),
    
    markedAt: Joi.date()
      .max('now')
      .optional(),
    
    markedBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    reason: Joi.string()
      .trim()
      .max(200)
      .when('status', {
        is: Joi.valid('absent', 'excused'),
        then: Joi.optional(),
        otherwise: Joi.forbidden()
      }),
    
    notes: Joi.string()
      .trim()
      .max(300)
      .optional()
  }),

  bulkMark: Joi.object({
    event: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    attendances: Joi.array()
      .items(
        Joi.object({
          user: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
          status: Joi.string().valid(...Object.values(ATTENDANCE_STATUS)).required(),
          reason: Joi.string().max(200).optional(),
          notes: Joi.string().max(300).optional()
        })
      )
      .min(1)
      .max(100)
      .required(),
    
    markedBy: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
  })
};

// Authentication validation schemas
const authSchemas = {
  register: Joi.object({
    fullName: Joi.string()
      .trim()
      .min(3)
      .max(100)
      .required()
      .messages({
        'string.empty': 'Full name is required',
        'string.min': 'Full name must be at least 3 characters long',
        'string.max': 'Full name cannot exceed 100 characters',
        'any.required': 'Full name is required'
      }),
    phoneNumber: Joi.string()
      .trim()
      .pattern(VALIDATION.PHONE_REGEX)
      .required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      }),
    email: Joi.string()
      .trim()
      .email()
      .allow('')
      .optional()
      .messages({
        'string.email': 'Please provide a valid email address'
      }),
    password: Joi.string()
      .min(VALIDATION.PASSWORD_MIN_LENGTH)
      .required()
      .pattern(VALIDATION.PASSWORD_REGEX)
      .messages({
        'string.empty': 'Password is required',
        'string.min': `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters long`,
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'Password is required'
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Please confirm your password'
      })
  }),

  verifyOTP: Joi.object({
    phoneNumber: Joi.string()
      .trim()
      .pattern(VALIDATION.PHONE_REGEX)
      .required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      }),
    otp: Joi.string()
      .trim()
      .length(VALIDATION.OTP_LENGTH)
      .required()
      .messages({
        'string.empty': 'OTP is required',
        'string.length': `OTP must be ${VALIDATION.OTP_LENGTH} characters long`,
        'any.required': 'OTP is required'
      })
  }),

  login: Joi.object({
    phoneNumber: Joi.string()
      .trim()
      .pattern(VALIDATION.PHONE_REGEX)
      .required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      }),
    password: Joi.string()
      .required()
      .messages({
        'string.empty': 'Password is required',
        'any.required': 'Password is required'
      })
  }),

  forgotPassword: Joi.object({
    phoneNumber: Joi.string().trim().pattern(VALIDATION.PHONE_REGEX).required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      })
  }),
  
  verifyPasswordResetSession: Joi.object({
    sessionToken: Joi.string().required()
      .messages({
        'string.empty': 'Session token is required',
        'any.required': 'Session token is required'
      }),
    otp: Joi.string().trim().length(VALIDATION.OTP_LENGTH).required()
      .messages({
        'string.empty': 'OTP is required',
        'string.length': `OTP must be ${VALIDATION.OTP_LENGTH} characters long`,
        'any.required': 'OTP is required'
      })
  }),
  
  completeSessionPasswordReset: Joi.object({
    sessionToken: Joi.string().required()
      .messages({
        'string.empty': 'Session token is required',
        'any.required': 'Session token is required'
      }),
    newPassword: Joi.string().min(VALIDATION.PASSWORD_MIN_LENGTH).required()
      .pattern(VALIDATION.PASSWORD_REGEX)
      .messages({
        'string.empty': 'New password is required',
        'string.min': `New password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters long`,
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'New password is required'
      }),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Please confirm your password'
      })
  }),
  
  completePasswordReset: Joi.object({
    resetToken: Joi.string()
      .required()
      .messages({
        'string.empty': 'Reset token is required',
        'any.required': 'Reset token is required'
      }),
    newPassword: Joi.string()
      .min(VALIDATION.PASSWORD_MIN_LENGTH)
      .required()
      .pattern(VALIDATION.PASSWORD_REGEX)
      .messages({
        'string.empty': 'New password is required',
        'string.min': `New password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters long`,
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'New password is required'
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Please confirm your password'
      })
  }),

  resetPassword: Joi.object({
    phoneNumber: Joi.string()
      .trim()
      .pattern(VALIDATION.PHONE_REGEX)
      .required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.pattern.base': 'Please provide a valid phone number',
        'any.required': 'Phone number is required'
      }),
    otp: Joi.string()
      .trim()
      .length(VALIDATION.OTP_LENGTH)
      .required()
      .messages({
        'string.empty': 'OTP is required',
        'string.length': `OTP must be ${VALIDATION.OTP_LENGTH} characters long`,
        'any.required': 'OTP is required'
      }),
    newPassword: Joi.string()
      .min(VALIDATION.PASSWORD_MIN_LENGTH)
      .required()
      .pattern(VALIDATION.PASSWORD_REGEX)
      .messages({
        'string.empty': 'New password is required',
        'string.min': `New password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters long`,
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        'any.required': 'New password is required'
      }),
    confirmPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Please confirm your password'
      })
  })
};

// Query parameter validation schemas
const querySchemas = {
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
  }),

  dateRange: Joi.object({
    startDate: Joi.date().optional(),
    endDate: Joi.date().min(Joi.ref('startDate')).optional(),
    timeframe: Joi.string().valid('today', 'week', 'month', 'quarter', 'year').optional()
  }),

  userFilters: Joi.object({
    role: Joi.string().valid(...Object.values(USER_ROLES)).optional(),
    departmentIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).optional(),
    ministry: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    isActive: Joi.boolean().optional(),
    search: Joi.string().trim().max(50).optional()
  }),

  eventFilters: Joi.object({
    type: Joi.string().valid(...Object.values(EVENT_TYPES)).optional(),
    status: Joi.string().valid('draft', 'published', 'active', 'completed', 'cancelled').optional(),
    departmentIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).optional(),
    search: Joi.string().trim().max(50).optional()
  })
};

// Business rule validators
const businessRules = {
  /**
   * Validate mutual exclusivity of departments
   */
  validateDepartmentMutualExclusivity: (userDepartments, allDepartments) => {
    // Check if user is trying to join mutually exclusive departments
    for (let i = 0; i < userDepartments.length; i++) {
      for (let j = i + 1; j < userDepartments.length; j++) {
        const dept1 = allDepartments.find(d => d._id.toString() === userDepartments[i]);
        const dept2 = allDepartments.find(d => d._id.toString() === userDepartments[j]);
        
        if (dept1?.mutuallyExclusive?.includes(dept2?._id) || 
            dept2?.mutuallyExclusive?.includes(dept1?._id)) {
          return {
            isValid: false,
            message: `Cannot join ${dept1?.name} and ${dept2?.name} simultaneously - they are mutually exclusive`
          };
        }
      }
    }
    
    return { isValid: true };
  },

  /**
   * Validate event scheduling conflicts
   */
  validateEventScheduling: (newEvent, existingEvents) => {
    const newStart = new Date(newEvent.startTime);
    const newEnd = new Date(newEvent.endTime);
    
    for (const event of existingEvents) {
      const existingStart = new Date(event.startTime);
      const existingEnd = new Date(event.endTime);
      
      // Check for time overlap
      if (newStart < existingEnd && newEnd > existingStart) {
        // Check if they share any target groups
        const sharedDepartments = newEvent.targetDepartments?.some(dept => 
          event.targetDepartments?.includes(dept)
        );
        
        if (sharedDepartments) {
          return {
            isValid: false,
            message: `Event conflicts with "${event.title}" for shared departments`
          };
        }
      }
    }
    
    return { isValid: true };
  },

  /**
   * Validate ministry membership rules
   */
  validateMinistryMembership: (userMinistries) => {
    if (userMinistries.length > 1) {
      return {
        isValid: false,
        message: 'A member can only belong to one ministry at a time'
      };
    }
    
    return { isValid: true };
  },

  /**
   * Validate clocker assignments
   */
  validateClockerAssignments: (assignments, userRole) => {
    if (userRole !== USER_ROLES.CLOCKER && assignments.length > 0) {
      return {
        isValid: false,
        message: 'Only clockers can have attendance assignments'
      };
    }
    
    if (userRole === USER_ROLES.CLOCKER && assignments.length === 0) {
      return {
        isValid: false,
        message: 'Clockers must have at least one assignment'
      };
    }
    
    return { isValid: true };
  }
};

// Main validation functions
const validate = {
  /**
   * Validate request data against schema
   */
  validateSchema: (data, schema, options = {}) => {
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      ...options
    });
    
    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        code: detail.type
      }));
      
      return {
        isValid: false,
        errors: details,
        message: 'Validation failed'
      };
    }
    
    return {
      isValid: true,
      data: value
    };
  },

  /**
   * Validate user data with business rules
   */
  validateUser: (userData, context = {}) => {
    const { isUpdate = false, existingUser = null, allDepartments = [] } = context;
    
    // Schema validation
    const schema = isUpdate ? userSchemas.update : userSchemas.create;
    const schemaResult = validate.validateSchema(userData, schema);
    
    if (!schemaResult.isValid) {
      return schemaResult;
    }
    
    // Business rule validations
    if (userData.departmentIds) {
      const mutualExclusivityResult = businessRules.validateDepartmentMutualExclusivity(
        userData.departmentIds, 
        allDepartments
      );
      
      if (!mutualExclusivityResult.isValid) {
        return mutualExclusivityResult;
      }
    }
    
    if (userData.ministries) {
      const ministryResult = businessRules.validateMinistryMembership(userData.ministries);
      if (!ministryResult.isValid) {
        return ministryResult;
      }
    }
    
    if (userData.clockerAssignments) {
      const clockerResult = businessRules.validateClockerAssignments(
        userData.clockerAssignments, 
        userData.role
      );
      
      if (!clockerResult.isValid) {
        return clockerResult;
      }
    }
    
    return schemaResult;
  },

  /**
   * Validate event data with business rules
   */
  validateEvent: (eventData, context = {}) => {
    const { isUpdate = false, existingEvents = [] } = context;
    
    // Schema validation
    const schema = isUpdate ? eventSchemas.update : eventSchemas.create;
    const schemaResult = validate.validateSchema(eventData, schema);
    
    if (!schemaResult.isValid) {
      return schemaResult;
    }
    
    // Business rule validations
    if (!isUpdate && eventData.startTime && eventData.endTime) {
      const schedulingResult = businessRules.validateEventScheduling(eventData, existingEvents);
      if (!schedulingResult.isValid) {
        return schedulingResult;
      }
    }
    
    return schemaResult;
  }
};

module.exports = {
  // Schemas
  userSchemas,
  eventSchemas,
  departmentSchemas,
  attendanceSchemas,
  authSchemas,
  querySchemas,
  
  // Custom validators
  customValidators,
  
  // Business rules
  businessRules,
  
  // Main validation functions
  validate,
  validateSchema: validate.validateSchema,
  validateUser: validate.validateUser,
  validateEvent: validate.validateEvent,
  
  // Helper functions
  isValidGhanaPhone: (phone) => {
    try {
      customValidators.ghanaPhone(phone, { error: () => ({ message: 'Invalid' }) });
      return true;
    } catch {
      return false;
    }
  },
  
  isValidEmail: (email) => {
    return Joi.string().email().validate(email).error === undefined;
  },
  
  isValidObjectId: (id) => {
    return /^[0-9a-fA-F]{24}$/.test(id);
  },
  
  sanitizeString: (str) => {
    return typeof str === 'string' ? str.trim().replace(/\s+/g, ' ') : str;
  },
  
  normalizePhone: (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      return '+233' + cleaned.substring(1);
    } else if (cleaned.startsWith('233')) {
      return '+' + cleaned;
    } else if (cleaned.length === 9) {
      return '+233' + cleaned;
    }
    return '+' + cleaned;
  }
}; 
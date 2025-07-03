// User Roles
const USER_ROLES = {
  SUPER_ADMIN: 'super-admin',
  SENIOR_PASTOR: 'senior-pastor',
  ASSOCIATE_PASTOR: 'associate-pastor',
  PASTOR: 'pastor',
  DEACON: 'deacon',
  DEPARTMENT_LEADER: 'department-leader',
  CLOCKER: 'clocker',
  MEMBER: 'member',
};

// Role hierarchy (higher index = higher privilege)
const ROLE_HIERARCHY = {
  [USER_ROLES.MEMBER]: 0,
  [USER_ROLES.CLOCKER]: 1,
  [USER_ROLES.DEPARTMENT_LEADER]: 2,
  [USER_ROLES.DEACON]: 3,
  [USER_ROLES.PASTOR]: 4,
  [USER_ROLES.ASSOCIATE_PASTOR]: 5,
  [USER_ROLES.SENIOR_PASTOR]: 6,
  [USER_ROLES.SUPER_ADMIN]: 7,
};

// Event Types
const EVENT_TYPES = {
  SERVICE: 'service',
  PRAYER: 'prayer',
  MEETING: 'meeting',
  SPECIAL: 'special',
  REHEARSAL: 'rehearsal',
  BIBLE_STUDY: 'bible-study',
  OUTREACH: 'outreach',
  FELLOWSHIP: 'fellowship',
  TRAINING: 'training',
  OTHER: 'other',
};

// Event Status
const EVENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  UPCOMING: 'upcoming',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
};

// Attendance Status
const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  EXCUSED: 'excused',
  LATE: 'late',
};

// Department Categories
const DEPARTMENT_CATEGORIES = {
  WORSHIP: 'worship',
  ADMINISTRATION: 'administration',
  OUTREACH: 'outreach',
  YOUTH: 'youth',
  TECHNICAL: 'technical',
  PASTORAL: 'pastoral',
  EDUCATION: 'education',
  WELFARE: 'welfare',
  OTHER: 'other',
};

// Target Audience Types
const TARGET_AUDIENCE = {
  ALL: 'all',
  DEPARTMENT: 'department',
  MINISTRY: 'ministry',
  PRAYER_TRIBE: 'prayer-tribe',
  SUBGROUP: 'subgroup',
  CUSTOM: 'custom',
};

// Days of Week
const DAYS_OF_WEEK = {
  MONDAY: 'monday',
  TUESDAY: 'tuesday',
  WEDNESDAY: 'wednesday',
  THURSDAY: 'thursday',
  FRIDAY: 'friday',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
};

// Clocker Scope Types
const CLOCKER_SCOPES = {
  DEPARTMENT: 'department',
  MINISTRY: 'ministry',
  PRAYER_TRIBE: 'prayer-tribe',
  SUBGROUP: 'subgroup',
};

// Action Types for Audit Logging
const AUDIT_ACTIONS = {
  // User actions
  USER_REGISTER: 'user.register',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role_change',
  USER_PASSWORD_CHANGE: 'user.password_change',
  
  // Department actions
  DEPARTMENT_CREATE: 'department.create',
  DEPARTMENT_UPDATE: 'department.update',
  DEPARTMENT_DELETE: 'department.delete',
  DEPARTMENT_MEMBER_ADD: 'department.member_add',
  DEPARTMENT_MEMBER_REMOVE: 'department.member_remove',
  DEPARTMENT_LEADER_ASSIGN: 'department.leader_assign',
  
  // Event actions
  EVENT_CREATE: 'event.create',
  EVENT_UPDATE: 'event.update',
  EVENT_DELETE: 'event.delete',
  EVENT_CANCEL: 'event.cancel',
  EVENT_COMPLETE: 'event.complete',
  EVENT_PARTICIPANT_ADD: 'event.participant_add',
  EVENT_PARTICIPANT_REMOVE: 'event.participant_remove',
  
  // Attendance actions
  ATTENDANCE_MARK: 'attendance.mark',
  ATTENDANCE_BULK_MARK: 'attendance.bulk_mark',
  ATTENDANCE_UPDATE: 'attendance.update',
  ATTENDANCE_DELETE: 'attendance.delete',
  
  // Ministry actions
  MINISTRY_CREATE: 'ministry.create',
  MINISTRY_UPDATE: 'ministry.update',
  MINISTRY_DELETE: 'ministry.delete',
  MINISTRY_MEMBER_ADD: 'ministry.member_add',
  MINISTRY_MEMBER_REMOVE: 'ministry.member_remove',
  
  // Prayer Tribe actions
  PRAYER_TRIBE_CREATE: 'prayer_tribe.create',
  PRAYER_TRIBE_UPDATE: 'prayer_tribe.update',
  PRAYER_TRIBE_DELETE: 'prayer_tribe.delete',
  PRAYER_TRIBE_MEMBER_ADD: 'prayer_tribe.member_add',
  PRAYER_TRIBE_MEMBER_REMOVE: 'prayer_tribe.member_remove',
  
  // System actions
  SYSTEM_BACKUP: 'system.backup',
  SYSTEM_RESTORE: 'system.restore',
  SYSTEM_CONFIG_UPDATE: 'system.config_update',
};

// Notification Types
const NOTIFICATION_TYPES = {
  EVENT_REMINDER: 'event_reminder',
  EVENT_UPDATE: 'event_update',
  EVENT_CANCELLED: 'event_cancelled',
  ATTENDANCE_MARKED: 'attendance_marked',
  ROLE_ASSIGNED: 'role_assigned',
  DEPARTMENT_ASSIGNED: 'department_assigned',
  CUSTOM: 'custom',
  GENERAL: 'general',
  BULK: 'bulk',
};

// Notification Status
const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  SCHEDULED: 'scheduled',
  DELIVERED: 'delivered',
  READ: 'read',
};

// File Types
const FILE_TYPES = {
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'txt'],
  SPREADSHEET: ['xls', 'xlsx', 'csv'],
};

// Pagination Defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

// Cache TTL (in seconds)
const CACHE_TTL = {
  USER_PROFILE: 3600, // 1 hour
  DEPARTMENT_LIST: 7200, // 2 hours
  EVENT_LIST: 1800, // 30 minutes
  ATTENDANCE_STATS: 3600, // 1 hour
  DASHBOARD_DATA: 900, // 15 minutes
  OTP: 300, // 5 minutes
  SESSION: 5400, // 90 minutes (JWT expiry)
};

// Validation Rules
const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
  PHONE_REGEX: /^(\+\d{1,3}[- ]?)?\d{10}$/,
  OTP_LENGTH: 6,
  MAX_FILE_SIZE_MB: 10,
};

// System Limits
const LIMITS = {
  MAX_BULK_OPERATIONS: 100,
  MAX_EVENT_PARTICIPANTS: 1000,
  MAX_SMS_RECIPIENTS: 500,
  MAX_EXPORT_RECORDS: 10000,
  MAX_CLOCKER_SCOPES: 5,
  MAX_DEPARTMENTS_PER_USER: 3,
};

// Error Codes
const ERROR_CODES = {
  // Authentication errors (1xxx)
  INVALID_CREDENTIALS: 1001,
  TOKEN_EXPIRED: 1002,
  TOKEN_INVALID: 1003,
  OTP_EXPIRED: 1004,
  OTP_INVALID: 1005,
  OTP_MAX_ATTEMPTS: 1006,
  ACCOUNT_LOCKED: 1007,
  ACCOUNT_INACTIVE: 1008,
  
  // Authorization errors (2xxx)
  UNAUTHORIZED: 2001,
  FORBIDDEN: 2002,
  INSUFFICIENT_PERMISSIONS: 2003,
  
  // Validation errors (3xxx)
  VALIDATION_ERROR: 3001,
  INVALID_PHONE_NUMBER: 3002,
  INVALID_PASSWORD: 3003,
  DUPLICATE_ENTRY: 3004,
  
  // Resource errors (4xxx)
  RESOURCE_NOT_FOUND: 4001,
  DEPARTMENT_NOT_FOUND: 4002,
  EVENT_NOT_FOUND: 4003,
  USER_NOT_FOUND: 4004,
  
  // Business logic errors (5xxx)
  DEPARTMENT_OVERLAP_VIOLATION: 5001,
  MINISTRY_RESTRICTION_VIOLATION: 5002,
  EVENT_ALREADY_CLOSED: 5003,
  ATTENDANCE_ALREADY_MARKED: 5004,
  INVALID_CLOCKER_SCOPE: 5005,
  
  // System errors (9xxx)
  INTERNAL_ERROR: 9001,
  DATABASE_ERROR: 9002,
  SMS_SERVICE_ERROR: 9003,
  FILE_UPLOAD_ERROR: 9004,
};

// Success Messages
const SUCCESS_MESSAGES = {
  // Authentication
  REGISTRATION_SUCCESS: 'Registration successful. Please verify your phone number.',
  LOGIN_SUCCESS: 'Login successful.',
  LOGOUT_SUCCESS: 'Logout successful.',
  OTP_SENT: 'OTP sent successfully.',
  OTP_VERIFIED: 'OTP verified successfully.',
  PASSWORD_CHANGED: 'Password changed successfully.',
  
  // User Management
  USER_CREATED: 'User created successfully.',
  USER_UPDATED: 'User updated successfully.',
  USER_DELETED: 'User deleted successfully.',
  ROLE_ASSIGNED: 'Role assigned successfully.',
  
  // Department Management
  DEPARTMENT_CREATED: 'Department created successfully.',
  DEPARTMENT_UPDATED: 'Department updated successfully.',
  DEPARTMENT_DELETED: 'Department deleted successfully.',
  MEMBER_ADDED: 'Member added successfully.',
  MEMBER_REMOVED: 'Member removed successfully.',
  
  // Event Management
  EVENT_CREATED: 'Event created successfully.',
  EVENT_UPDATED: 'Event updated successfully.',
  EVENT_CANCELLED: 'Event cancelled successfully.',
  EVENT_COMPLETED: 'Event completed successfully.',
  
  // Attendance
  ATTENDANCE_MARKED: 'Attendance marked successfully.',
  ATTENDANCE_UPDATED: 'Attendance updated successfully.',
  BULK_ATTENDANCE_MARKED: 'Bulk attendance marked successfully.',
  
  // General
  OPERATION_SUCCESS: 'Operation completed successfully.',
  DATA_EXPORTED: 'Data exported successfully.',
  NOTIFICATION_SENT: 'Notification sent successfully.',
};

// Export all constants
module.exports = {
  USER_ROLES,
  ROLE_HIERARCHY,
  EVENT_TYPES,
  EVENT_STATUS,
  ATTENDANCE_STATUS,
  DEPARTMENT_CATEGORIES,
  TARGET_AUDIENCE,
  DAYS_OF_WEEK,
  CLOCKER_SCOPES,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
  FILE_TYPES,
  PAGINATION,
  CACHE_TTL,
  VALIDATION,
  LIMITS,
  ERROR_CODES,
  SUCCESS_MESSAGES,
}; 
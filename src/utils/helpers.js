// Helpers
// General utility functions for the backend

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { USER_ROLES, EVENT_TYPES, ATTENDANCE_STATUS } = require('./constants');

// Date and Time Helpers
const dateHelpers = {
  /**
   * Format date for Ghana timezone
   * @param {Date} date - Date to format
   * @param {string} format - Format type ('short', 'long', 'time', 'datetime')
   * @returns {string} Formatted date string
   */
  formatGhanaDate: (date, format = 'short') => {
    if (!date) return '';
    
    const ghanaDate = new Date(date);
    const options = { timeZone: 'Africa/Accra' };
    
    switch (format) {
      case 'short':
        return ghanaDate.toLocaleDateString('en-GB', { ...options, day: '2-digit', month: '2-digit', year: 'numeric' });
      
      case 'long':
        return ghanaDate.toLocaleDateString('en-GB', { 
          ...options, 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long', 
          year: 'numeric' 
        });
      
      case 'time':
        return ghanaDate.toLocaleTimeString('en-GB', { ...options, hour: '2-digit', minute: '2-digit' });
      
      case 'datetime':
        return ghanaDate.toLocaleString('en-GB', { 
          ...options, 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric',
          hour: '2-digit', 
          minute: '2-digit' 
        });
      
      case 'church':
        // Format for church announcements: "Sunday, 15th January 2024 at 9:00 AM"
        const dayWithSuffix = dateHelpers.addOrdinalSuffix(ghanaDate.getDate());
        return ghanaDate.toLocaleDateString('en-GB', { 
          ...options, 
          weekday: 'long', 
          month: 'long', 
          year: 'numeric' 
        }).replace(/\d+/, dayWithSuffix) + ' at ' + ghanaDate.toLocaleTimeString('en-GB', { 
          ...options, 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
      
      default:
        return ghanaDate.toLocaleDateString('en-GB', options);
    }
  },

  /**
   * Add ordinal suffix to numbers (1st, 2nd, 3rd, etc.)
   */
  addOrdinalSuffix: (num) => {
    const j = num % 10;
    const k = num % 100;
    
    if (j === 1 && k !== 11) return num + 'st';
    if (j === 2 && k !== 12) return num + 'nd';
    if (j === 3 && k !== 13) return num + 'rd';
    return num + 'th';
  },

  /**
   * Get Ghana time now
   */
  getGhanaTime: () => {
    return new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra' });
  },

  /**
   * Calculate age from date of birth
   */
  calculateAge: (dateOfBirth) => {
    if (!dateOfBirth) return null;
    
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  },

  /**
   * Get day of week for church schedules
   */
  getChurchDay: (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date(date).getDay()];
  },

  /**
   * Check if date is weekend (Friday evening, Saturday, Sunday)
   */
  isWeekend: (date) => {
    const day = new Date(date).getDay();
    const hour = new Date(date).getHours();
    
    // Friday evening (after 6 PM), Saturday, or Sunday
    return day === 0 || day === 6 || (day === 5 && hour >= 18);
  },

  /**
   * Get time until event
   */
  getTimeUntilEvent: (eventDate) => {
    const now = new Date();
    const event = new Date(eventDate);
    const diffMs = event - now;
    
    if (diffMs <= 0) return 'Event has started';
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
};

// String Helpers
const stringHelpers = {
  /**
   * Capitalize first letter of each word
   */
  titleCase: (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  },

  /**
   * Generate initials from name
   */
  getInitials: (firstName, lastName) => {
    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return `${first}${last}`;
  },

  /**
   * Format full name
   */
  formatFullName: (firstName, lastName, format = 'full') => {
    if (!firstName && !lastName) return '';
    
    switch (format) {
      case 'first':
        return firstName || '';
      case 'last':
        return lastName || '';
      case 'lastFirst':
        return `${lastName}, ${firstName}`;
      case 'initials':
        return stringHelpers.getInitials(firstName, lastName);
      default:
        return `${firstName || ''} ${lastName || ''}`.trim();
    }
  },

  /**
   * Truncate text with ellipsis
   */
  truncateText: (text, maxLength = 100, suffix = '...') => {
    if (!text || text.length <= maxLength) return text || '';
    return text.substring(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Generate slug from text
   */
  generateSlug: (text) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  },

  /**
   * Sanitize text for safe display
   */
  sanitizeText: (text) => {
    if (!text) return '';
    return text
      .replace(/[<>]/g, '') // Remove potential HTML
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  },

  /**
   * Generate random code
   */
  generateCode: (length = 6, type = 'numeric') => {
    const charset = {
      numeric: '0123456789',
      alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    };
    
    const chars = charset[type] || charset.numeric;
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }
};

// Phone Number Helpers
const phoneHelpers = {
  /**
   * Format Ghana phone number for display
   */
  formatForDisplay: (phone) => {
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    
    // Format as +233 XX XXX XXXX
    if (cleaned.startsWith('233') && cleaned.length === 12) {
      return `+233 ${cleaned.substr(3, 2)} ${cleaned.substr(5, 3)} ${cleaned.substr(8, 4)}`;
    }
    
    // Format as 0XX XXX XXXX
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return `${cleaned.substr(0, 3)} ${cleaned.substr(3, 3)} ${cleaned.substr(6, 4)}`;
    }
    
    return phone; // Return as-is if format not recognized
  },

  /**
   * Normalize phone number for storage
   */
  normalizeForStorage: (phone) => {
    if (!phone) return '';
    
    const cleaned = phone.replace(/\D/g, '');
    
    // Convert to +233 format
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return `+233${cleaned.substring(1)}`;
    } else if (cleaned.startsWith('233') && cleaned.length === 12) {
      return `+${cleaned}`;
    } else if (cleaned.length === 9) {
      return `+233${cleaned}`;
    }
    
    return `+${cleaned}`;
  },

  /**
   * Validate Ghana phone number
   */
  isValid: (phone) => {
    if (!phone) return false;
    
    const cleaned = phone.replace(/\D/g, '');
    const patterns = [
      /^233[0-9]{9}$/, // +233 format
      /^0[0-9]{9}$/,   // 0 prefix format
      /^[0-9]{9}$/     // 9-digit format
    ];
    
    return patterns.some(pattern => pattern.test(cleaned));
  },

  /**
   * Get phone carrier (basic detection)
   */
  getCarrier: (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    let number = cleaned;
    
    // Normalize to 0XXXXXXXXX format
    if (number.startsWith('233')) {
      number = '0' + number.substring(3);
    } else if (number.length === 9) {
      number = '0' + number;
    }
    
    if (number.length !== 10) return 'Unknown';
    
    const prefix = number.substring(0, 3);
    
    // Ghana carrier prefixes
    const carriers = {
      '020': 'Vodafone', '050': 'Vodafone',
      '024': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
      '026': 'AirtelTigo', '056': 'AirtelTigo', '027': 'AirtelTigo', '057': 'AirtelTigo',
      '028': 'Glo', '058': 'Glo'
    };
    
    return carriers[prefix] || 'Unknown';
  }
};

// Data Processing Helpers
const dataHelpers = {
  /**
   * Group array by property
   */
  groupBy: (array, key) => {
    if (!Array.isArray(array)) return {};
    
    return array.reduce((groups, item) => {
      const group = item[key];
      groups[group] = groups[group] || [];
      groups[group].push(item);
      return groups;
    }, {});
  },

  /**
   * Sort array by multiple fields
   */
  sortBy: (array, fields) => {
    if (!Array.isArray(array)) return [];
    
    return array.sort((a, b) => {
      for (const field of fields) {
        const { key, direction = 'asc' } = typeof field === 'string' ? { key: field } : field;
        
        let aVal = dataHelpers.getNestedValue(a, key);
        let bVal = dataHelpers.getNestedValue(b, key);
        
        // Handle dates
        if (aVal instanceof Date) aVal = aVal.getTime();
        if (bVal instanceof Date) bVal = bVal.getTime();
        
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  },

  /**
   * Get nested object value
   */
  getNestedValue: (obj, path) => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  },

  /**
   * Filter array with multiple conditions
   */
  filterBy: (array, filters) => {
    if (!Array.isArray(array)) return [];
    
    return array.filter(item => {
      return Object.entries(filters).every(([key, value]) => {
        if (value === undefined || value === null || value === '') return true;
        
        const itemValue = dataHelpers.getNestedValue(item, key);
        
        if (Array.isArray(value)) {
          return value.includes(itemValue);
        }
        
        if (typeof value === 'string' && typeof itemValue === 'string') {
          return itemValue.toLowerCase().includes(value.toLowerCase());
        }
        
        return itemValue === value;
      });
    });
  },

  /**
   * Paginate array
   */
  paginate: (array, page = 1, limit = 10) => {
    if (!Array.isArray(array)) return { data: [], totalPages: 0, currentPage: 1, totalItems: 0 };
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    return {
      data: array.slice(startIndex, endIndex),
      totalPages: Math.ceil(array.length / limit),
      currentPage: page,
      totalItems: array.length,
      hasNext: endIndex < array.length,
      hasPrev: page > 1
    };
  },

  /**
   * Calculate statistics
   */
  calculateStats: (numbers) => {
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return { count: 0, sum: 0, average: 0, min: 0, max: 0 };
    }
    
    const validNumbers = numbers.filter(n => typeof n === 'number' && !isNaN(n));
    
    if (validNumbers.length === 0) {
      return { count: 0, sum: 0, average: 0, min: 0, max: 0 };
    }
    
    const sum = validNumbers.reduce((acc, n) => acc + n, 0);
    
    return {
      count: validNumbers.length,
      sum: sum,
      average: sum / validNumbers.length,
      min: Math.min(...validNumbers),
      max: Math.max(...validNumbers)
    };
  }
};

// Church-Specific Helpers
const churchHelpers = {
  /**
   * Generate member ID
   */
  generateMemberId: (firstName, lastName, joinYear) => {
    const year = joinYear || new Date().getFullYear();
    const initials = stringHelpers.getInitials(firstName, lastName);
    const randomNum = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `CAM${year}${initials}${randomNum}`;
  },

  /**
   * Format church role display
   */
  formatRoleDisplay: (role) => {
    const roleDisplayNames = {
      [USER_ROLES.SUPER_ADMIN]: 'System Administrator',
      [USER_ROLES.SENIOR_PASTOR]: 'Senior Pastor',
      [USER_ROLES.ASSOCIATE_PASTOR]: 'Associate Pastor',
      [USER_ROLES.PASTOR]: 'Pastor',
      [USER_ROLES.DEPARTMENT_LEADER]: 'Department Leader',
      [USER_ROLES.CLOCKER]: 'Attendance Clocker',
      [USER_ROLES.MEMBER]: 'Church Member'
    };
    
    return roleDisplayNames[role] || role;
  },

  /**
   * Get role hierarchy level
   */
  getRoleLevel: (role) => {
    const levels = {
      [USER_ROLES.SUPER_ADMIN]: 6,
      [USER_ROLES.SENIOR_PASTOR]: 5,
      [USER_ROLES.ASSOCIATE_PASTOR]: 4,
      [USER_ROLES.PASTOR]: 3,
      [USER_ROLES.DEPARTMENT_LEADER]: 2,
      [USER_ROLES.CLOCKER]: 1,
      [USER_ROLES.MEMBER]: 0
    };
    
    return levels[role] || 0;
  },

  /**
   * Format event type for display
   */
  formatEventType: (type) => {
    const typeDisplayNames = {
      [EVENT_TYPES.SUNDAY_SERVICE]: 'Sunday Service',
      [EVENT_TYPES.MIDWEEK_SERVICE]: 'Midweek Service',
      [EVENT_TYPES.PRAYER_MEETING]: 'Prayer Meeting',
      [EVENT_TYPES.BIBLE_STUDY]: 'Bible Study',
      [EVENT_TYPES.CHOIR_REHEARSAL]: 'Choir Rehearsal',
      [EVENT_TYPES.YOUTH_MEETING]: 'Youth Meeting',
      [EVENT_TYPES.WOMEN_MEETING]: 'Women\'s Meeting',
      [EVENT_TYPES.MEN_MEETING]: 'Men\'s Meeting',
      [EVENT_TYPES.CHILDREN_SERVICE]: 'Children\'s Service',
      [EVENT_TYPES.SPECIAL_EVENT]: 'Special Event',
      [EVENT_TYPES.CONFERENCE]: 'Conference',
      [EVENT_TYPES.CRUSADE]: 'Crusade',
      [EVENT_TYPES.FUNERAL]: 'Funeral Service',
      [EVENT_TYPES.WEDDING]: 'Wedding Ceremony',
      [EVENT_TYPES.DEDICATION]: 'Dedication Service'
    };
    
    return typeDisplayNames[type] || type;
  },

  /**
   * Generate event code
   */
  generateEventCode: (eventType, date) => {
    const typeCode = eventType.substring(0, 3).toUpperCase();
    const dateCode = new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
    const randomCode = stringHelpers.generateCode(3, 'alphanumeric');
    return `${typeCode}${dateCode}${randomCode}`;
  },

  /**
   * Check if event is service
   */
  isServiceEvent: (eventType) => {
    const serviceTypes = [
      EVENT_TYPES.SUNDAY_SERVICE,
      EVENT_TYPES.MIDWEEK_SERVICE,
      EVENT_TYPES.CHILDREN_SERVICE,
      EVENT_TYPES.FUNERAL,
      EVENT_TYPES.WEDDING,
      EVENT_TYPES.DEDICATION
    ];
    
    return serviceTypes.includes(eventType);
  },

  /**
   * Get attendance status display
   */
  formatAttendanceStatus: (status) => {
    const statusDisplayNames = {
      [ATTENDANCE_STATUS.PRESENT]: 'Present',
      [ATTENDANCE_STATUS.ABSENT]: 'Absent',
      [ATTENDANCE_STATUS.LATE]: 'Late',
      [ATTENDANCE_STATUS.EXCUSED]: 'Excused',
      [ATTENDANCE_STATUS.PENDING]: 'Pending'
    };
    
    return statusDisplayNames[status] || status;
  },

  /**
   * Calculate attendance percentage
   */
  calculateAttendanceRate: (attendanceRecords) => {
    if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) return 0;
    
    const presentCount = attendanceRecords.filter(record => 
      [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE].includes(record.status)
    ).length;
    
    return Math.round((presentCount / attendanceRecords.length) * 100);
  }
};

// Security Helpers
const securityHelpers = {
  /**
   * Generate secure random token
   */
  generateToken: (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
  },

  /**
   * Hash password
   */
  hashPassword: async (password) => {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  },

  /**
   * Verify password
   */
  verifyPassword: async (password, hash) => {
    return await bcrypt.compare(password, hash);
  },

  /**
   * Generate OTP
   */
  generateOTP: (length = 6) => {
    return stringHelpers.generateCode(length, 'numeric');
  },

  /**
   * Mask sensitive data
   */
  maskPhone: (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 4) return phone;
    
    const visible = cleaned.slice(-4);
    const masked = '*'.repeat(cleaned.length - 4);
    return `${masked}${visible}`;
  },

  /**
   * Generate secure filename
   */
  generateSecureFilename: (originalName) => {
    const extension = originalName.split('.').pop();
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${randomString}.${extension}`;
  }
};

// API Response Helpers
const responseHelpers = {
  /**
   * Standard success response
   */
  success: (data = null, message = 'Success', meta = {}) => {
    return {
      success: true,
      message,
      data,
      meta: {
        timestamp: new Date(),
        ...meta
      }
    };
  },

  /**
   * Standard error response
   */
  error: (message = 'An error occurred', code = 'INTERNAL_ERROR', details = null) => {
    return {
      success: false,
      error: {
        message,
        code,
        details,
        timestamp: new Date()
      }
    };
  },

  /**
   * Paginated response
   */
  paginated: (data, pagination, message = 'Success') => {
    return {
      success: true,
      message,
      data,
      pagination: {
        ...pagination,
        timestamp: new Date()
      }
    };
  },

  /**
   * Validation error response
   */
  validationError: (errors, message = 'Validation failed') => {
    return {
      success: false,
      error: {
        message,
        code: 'VALIDATION_ERROR',
        details: errors,
        timestamp: new Date()
      }
    };
  }
};

// Export all helpers
module.exports = {
  // Date and time helpers
  ...dateHelpers,
  date: dateHelpers,
  
  // String manipulation helpers
  ...stringHelpers,
  string: stringHelpers,
  
  // Phone number helpers
  phone: phoneHelpers,
  
  // Data processing helpers
  data: dataHelpers,
  
  // Church-specific helpers
  church: churchHelpers,
  
  // Security helpers
  security: securityHelpers,
  
  // API response helpers
  response: responseHelpers,
  
  // Utility functions
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  isProduction: () => process.env.NODE_ENV === 'production',
  
  isDevelopment: () => process.env.NODE_ENV === 'development',
  
  /**
   * Log error with context
   */
  logError: (error, context = {}) => {
    console.error('Error occurred:', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date()
    });
  },
  
  /**
   * Safe JSON parse
   */
  safeJsonParse: (str, defaultValue = null) => {
    try {
      return JSON.parse(str);
    } catch {
      return defaultValue;
    }
  },
  
  /**
   * Generate UUID v4
   */
  generateUUID: () => {
    return crypto.randomUUID();
  },
  
  /**
   * Deep clone object
   */
  deepClone: (obj) => {
    return JSON.parse(JSON.stringify(obj));
  },
  
  /**
   * Check if object is empty
   */
  isEmpty: (obj) => {
    if (obj == null) return true;
    if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0;
    return Object.keys(obj).length === 0;
  }
}; 
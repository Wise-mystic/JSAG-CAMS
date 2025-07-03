const { ApiError } = require('./error.middleware');
const { ERROR_CODES, USER_ROLES, ROLE_HIERARCHY } = require('../utils/constants');

// Check if user has specific role
const hasRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const userRole = req.user.role;
    
    // Check if user has one of the allowed roles
    if (allowedRoles.includes(userRole)) {
      return next();
    }
    
    // Check if user has a higher role in the hierarchy
    const userRoleLevel = ROLE_HIERARCHY[userRole];
    const hasHigherRole = allowedRoles.some(role => {
      const requiredLevel = ROLE_HIERARCHY[role];
      return userRoleLevel >= requiredLevel;
    });
    
    if (hasHigherRole) {
      return next();
    }
    
    return next(ApiError.forbidden(
      'You do not have permission to perform this action',
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Check if user has minimum role level
const hasMinRole = (minimumRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const userRole = req.user.role;
    const userRoleLevel = ROLE_HIERARCHY[userRole];
    const requiredLevel = ROLE_HIERARCHY[minimumRole];
    
    if (userRoleLevel >= requiredLevel) {
      return next();
    }
    
    return next(ApiError.forbidden(
      `Minimum role of ${minimumRole} required`,
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Check if user can access their own resource or has admin role
const canAccessOwnResource = (userIdParam = 'id') => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const userId = req.params[userIdParam];
    const requestingUserId = req.user._id.toString();
    
    // User can access their own resource
    if (userId === requestingUserId) {
      return next();
    }
    
    // Admin roles can access any resource
    const adminRoles = [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR];
    if (adminRoles.includes(req.user.role)) {
      return next();
    }
    
    return next(ApiError.forbidden(
      'You can only access your own resources',
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Check if user can manage a department
const canManageDepartment = () => {
  return async (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const departmentId = req.params.departmentId || req.body.departmentId;
    
    // Super admin and senior pastor can manage any department
    if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR].includes(req.user.role)) {
      return next();
    }
    
    // Associate pastor can manage departments
    if (req.user.role === USER_ROLES.ASSOCIATE_PASTOR) {
      return next();
    }
    
    // Department leader can only manage their own departments
    if (req.user.role === USER_ROLES.DEPARTMENT_LEADER) {
      if (!req.user.departmentIds || !req.user.departmentIds.includes(departmentId)) {
        return next(ApiError.forbidden(
          'You do not have permission to manage this department',
          ERROR_CODES.INSUFFICIENT_PERMISSIONS
        ));
      }
      return next();
    }
    
    return next(ApiError.forbidden(
      'You do not have permission to manage this department',
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Check if user is a clocker for specific scope
const isClocker = () => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    // Clockers and higher roles can create events
    const allowedRoles = [
      USER_ROLES.CLOCKER,
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.DEACON,
      USER_ROLES.PASTOR,
      USER_ROLES.ASSOCIATE_PASTOR,
      USER_ROLES.SENIOR_PASTOR,
      USER_ROLES.SUPER_ADMIN,
    ];
    
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden(
        'You must be a clocker or higher to perform this action',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      ));
    }
    
    // Store clocker status for later use
    req.isClocker = req.user.role === USER_ROLES.CLOCKER;
    
    next();
  };
};

// Check if clocker can access specific scope
const checkClockerScope = () => {
  return async (req, res, next) => {
    // Skip check for non-clockers (they have broader access)
    if (!req.isClocker) {
      return next();
    }
    
    const { targetAudience, targetIds } = req.body;
    
    if (!targetAudience || !targetIds || targetIds.length === 0) {
      return next(ApiError.badRequest('Target audience and IDs required'));
    }
    
    // Check if clocker has access to all target IDs
    const hasAccess = targetIds.every(targetId => {
      return req.user.clockerScopes.some(scope => 
        scope.type === targetAudience && 
        scope.targetId.toString() === targetId.toString()
      );
    });
    
    if (!hasAccess) {
      return next(ApiError.forbidden(
        'You can only create events for your assigned groups',
        ERROR_CODES.INVALID_CLOCKER_SCOPE
      ));
    }
    
    next();
  };
};

// Check if user can assign roles
const canAssignRoles = () => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const { role: newRole } = req.body;
    const assignerRole = req.user.role;
    
    // Super admin can assign any role
    if (assignerRole === USER_ROLES.SUPER_ADMIN) {
      return next();
    }
    
    // Senior pastor can assign roles except super admin
    if (assignerRole === USER_ROLES.SENIOR_PASTOR) {
      if (newRole !== USER_ROLES.SUPER_ADMIN) {
        return next();
      }
    }
    
    // Associate pastor can assign lower roles
    if (assignerRole === USER_ROLES.ASSOCIATE_PASTOR) {
      const assignerLevel = ROLE_HIERARCHY[assignerRole];
      const newRoleLevel = ROLE_HIERARCHY[newRole];
      
      if (newRoleLevel < assignerLevel) {
        return next();
      }
    }
    
    // Department leader can only assign clocker role within their department
    if (assignerRole === USER_ROLES.DEPARTMENT_LEADER && newRole === USER_ROLES.CLOCKER) {
      // Additional department check would be done in the controller
      return next();
    }
    
    return next(ApiError.forbidden(
      'You do not have permission to assign this role',
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Generic permission checker
const checkPermission = (permission) => {
  const permissionMap = {
    // System permissions
    'system.manage': [USER_ROLES.SUPER_ADMIN],
    'system.view_logs': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    
    // User permissions
    'users.create': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    'users.view_all': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    'users.read': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
    'users.update': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    'users.update_any': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    'users.delete': [USER_ROLES.SUPER_ADMIN],
    'users.export': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
    'users.assign_role': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    'users.deactivate': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    
    // Department permissions
    'departments.create': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    'departments.delete': [USER_ROLES.SUPER_ADMIN],
    
    // Event permissions
    'events.create_any': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
    'events.delete_any': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    
    // Attendance permissions
    'attendance.read': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER],
    
    // Reports permissions
    'reports.view_all': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
    'reports.export': [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
  };
  
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED));
    }
    
    const allowedRoles = permissionMap[permission];
    if (!allowedRoles) {
      return next(ApiError.internal('Invalid permission specified'));
    }
    
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }
    
    // Check role hierarchy
    const userRoleLevel = ROLE_HIERARCHY[req.user.role];
    const hasHigherRole = allowedRoles.some(role => {
      const requiredLevel = ROLE_HIERARCHY[role];
      return userRoleLevel >= requiredLevel;
    });
    
    if (hasHigherRole) {
      return next();
    }
    
    return next(ApiError.forbidden(
      'Insufficient permissions',
      ERROR_CODES.INSUFFICIENT_PERMISSIONS
    ));
  };
};

// Authorize middleware factory
const authorize = (options) => {
  const {
    permission,
    allowedRoles,
    checkHierarchy = false,
    checkOwnership = false,
    checkDepartmentAccess = false
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw ApiError.unauthorized('Authentication required', ERROR_CODES.UNAUTHORIZED);
      }

      const userRole = req.user.role;
      
      // Debug logging
      console.log('Authorization check:', {
        userId: req.user._id || req.user.id,
        userRole: userRole,
        requestedPermission: permission,
        allowedRoles: allowedRoles
      });

      // Super admin has all permissions
      if (userRole === USER_ROLES.SUPER_ADMIN) {
        return next();
      }

      // Check role-based access
      if (allowedRoles && !allowedRoles.includes(userRole)) {
        // If hierarchy check is enabled, check if user has a higher role
        if (checkHierarchy) {
          const userRoleLevel = ROLE_HIERARCHY[userRole];
          const hasHigherRole = allowedRoles.some(role => {
            const requiredLevel = ROLE_HIERARCHY[role];
            return userRoleLevel >= requiredLevel;
          });

          if (!hasHigherRole) {
            throw ApiError.forbidden(
              'You do not have permission to perform this action',
              ERROR_CODES.INSUFFICIENT_PERMISSIONS
            );
          }
        } else {
          throw ApiError.forbidden(
            'You do not have permission to perform this action',
            ERROR_CODES.INSUFFICIENT_PERMISSIONS
          );
        }
      }

      // Check permission-based access
      if (permission) {
        let hasPermission = false;
        try {
          await new Promise((resolve, reject) => {
            checkPermission(permission)(req, res, (error) => {
              if (error) {
                reject(error);
              } else {
                hasPermission = true;
                resolve();
              }
            });
          });
        } catch (error) {
          throw ApiError.forbidden(
            'You do not have the required permission',
            ERROR_CODES.INSUFFICIENT_PERMISSIONS
          );
        }
      }

      // Check resource ownership
      if (checkOwnership) {
        const resourceId = req.params.id;
        const requestingUserId = req.user._id.toString();

        if (resourceId !== requestingUserId) {
          // Allow access if user has admin role
          const adminRoles = [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR];
          if (!adminRoles.includes(userRole)) {
            throw ApiError.forbidden(
              'You can only access your own resources',
              ERROR_CODES.INSUFFICIENT_PERMISSIONS
            );
          }
        }
      }

      // Check department access
      if (checkDepartmentAccess) {
        const departmentId = req.params.departmentId || req.body.departmentId;
        if (departmentId) {
          const hasAccess = await canManageDepartment()(req, res, () => {});
          if (!hasAccess) {
            throw ApiError.forbidden(
              'You do not have access to this department',
              ERROR_CODES.INSUFFICIENT_PERMISSIONS
            );
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  hasRole,
  hasMinRole,
  canAccessOwnResource,
  canManageDepartment,
  isClocker,
  checkClockerScope,
  canAssignRoles,
  authorize
}; 
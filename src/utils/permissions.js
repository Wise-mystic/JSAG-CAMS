// Permissions
// Defines role-based permissions and access rules

const { USER_ROLES, PERMISSIONS, RESOURCES } = require('./constants');

class PermissionSystem {
  constructor() {
    this.roleHierarchy = this.buildRoleHierarchy();
    this.permissions = this.buildPermissions();
    this.resourcePermissions = this.buildResourcePermissions();
  }

  /**
   * Build role hierarchy (higher roles inherit lower role permissions)
   */
  buildRoleHierarchy() {
    return {
      [USER_ROLES.SUPER_ADMIN]: 6,
      [USER_ROLES.SENIOR_PASTOR]: 5,
      [USER_ROLES.ASSOCIATE_PASTOR]: 4,
      [USER_ROLES.PASTOR]: 3,
      [USER_ROLES.DEPARTMENT_LEADER]: 2,
      [USER_ROLES.CLOCKER]: 1,
      [USER_ROLES.MEMBER]: 0
    };
  }

  /**
   * Build comprehensive permission matrix
   */
  buildPermissions() {
    return {
      // Super Admin - Full system access
      [USER_ROLES.SUPER_ADMIN]: [
        'system:*',
        'users:*',
        'events:*',
        'attendance:*',
        'departments:*',
        'ministries:*',
        'reports:*',
        'notifications:*',
        'analytics:*',
        'audit:*',
        'settings:*'
      ],

      // Senior Pastor - Full church management
      [USER_ROLES.SENIOR_PASTOR]: [
        'users:read', 'users:create', 'users:update', 'users:deactivate',
        'events:*',
        'attendance:read', 'attendance:mark', 'attendance:update', 'attendance:reports',
        'departments:*',
        'ministries:*',
        'reports:*',
        'notifications:send', 'notifications:read',
        'analytics:read', 'analytics:export',
        'audit:read',
        'settings:church'
      ],

      // Associate Pastor - Limited administrative access
      [USER_ROLES.ASSOCIATE_PASTOR]: [
        'users:read', 'users:update',
        'events:read', 'events:create', 'events:update',
        'attendance:read', 'attendance:mark', 'attendance:reports',
        'departments:read', 'departments:update',
        'ministries:read', 'ministries:update',
        'reports:read', 'reports:generate',
        'notifications:send', 'notifications:read',
        'analytics:read'
      ],

      // Pastor - Departmental management
      [USER_ROLES.PASTOR]: [
        'users:read',
        'events:read', 'events:create', 'events:update:own',
        'attendance:read', 'attendance:mark', 'attendance:reports:department',
        'departments:read',
        'ministries:read',
        'reports:read:department',
        'notifications:send:department'
      ],

      // Department Leader - Department-specific access
      [USER_ROLES.DEPARTMENT_LEADER]: [
        'users:read:department',
        'events:read', 'events:create:department', 'events:update:own',
        'attendance:read:department', 'attendance:mark:department',
        'departments:read:own',
        'ministries:read:own',
        'reports:read:own',
        'notifications:send:department'
      ],

      // Clocker - Attendance focused
      [USER_ROLES.CLOCKER]: [
        'attendance:read:assigned', 'attendance:mark:assigned', 'attendance:update:assigned',
        'events:read:assigned',
        'users:read:basic'
      ],

      // Member - Basic access
      [USER_ROLES.MEMBER]: [
        'events:read:public',
        'attendance:read:own',
        'profile:read', 'profile:update:own',
        'notifications:read:own'
      ]
    };
  }

  /**
   * Build resource-specific permissions
   */
  buildResourcePermissions() {
    return {
      // User resource permissions
      users: {
        create: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
        read: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
        update: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
        delete: [USER_ROLES.SUPER_ADMIN],
        deactivate: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR]
      },

      // Event resource permissions
      events: {
        create: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER],
        read: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER, USER_ROLES.CLOCKER, USER_ROLES.MEMBER],
        update: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR],
        delete: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
        cancel: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR]
      },

      // Attendance resource permissions
      attendance: {
        mark: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER, USER_ROLES.CLOCKER],
        read: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER, USER_ROLES.CLOCKER],
        update: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.CLOCKER],
        delete: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
        reports: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR]
      },

      // Department resource permissions
      departments: {
        create: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
        read: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR, USER_ROLES.PASTOR, USER_ROLES.DEPARTMENT_LEADER],
        update: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.ASSOCIATE_PASTOR],
        delete: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR],
        manage_members: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR, USER_ROLES.DEPARTMENT_LEADER]
      }
    };
  }

  /**
   * Check if user has specific permission
   * @param {string} userRole - User's role
   * @param {string} permission - Permission to check (e.g., 'users:read')
   * @param {Object} context - Additional context (resource ownership, department, etc.)
   * @returns {boolean} - Whether user has permission
   */
  hasPermission(userRole, permission, context = {}) {
    try {
      if (!userRole || !permission) {
        return false;
      }

      // Super Admin has all permissions
      if (userRole === USER_ROLES.SUPER_ADMIN) {
        return true;
      }

      const userPermissions = this.permissions[userRole] || [];
      
      // Check for exact permission match
      if (userPermissions.includes(permission)) {
        return true;
      }

      // Check for wildcard permissions
      const [resource, action] = permission.split(':');
      const wildcardPermission = `${resource}:*`;
      if (userPermissions.includes(wildcardPermission)) {
        return true;
      }

      // Check system-wide wildcard
      if (userPermissions.includes('system:*')) {
        return true;
      }

      // Context-based permission checks
      return this.checkContextualPermission(userRole, permission, context);

    } catch (error) {
      return false;
    }
  }

  /**
   * Check contextual permissions (ownership, department, etc.)
   * @param {string} userRole - User's role
   * @param {string} permission - Permission to check
   * @param {Object} context - Context object
   * @returns {boolean} - Whether user has contextual permission
   */
  checkContextualPermission(userRole, permission, context) {
    const { userId, ownerId, department, userDepartments, assignedGroups, resourceType } = context;

    // Check ownership-based permissions
    if (permission.includes(':own') && userId === ownerId) {
      return true;
    }

    // Check department-based permissions
    if (permission.includes(':department')) {
      if (userRole === USER_ROLES.DEPARTMENT_LEADER && userDepartments?.includes(department)) {
        return true;
      }
      if (userRole === USER_ROLES.PASTOR && userDepartments?.includes(department)) {
        return true;
      }
    }

    // Check assigned group permissions for Clockers
    if (permission.includes(':assigned') && userRole === USER_ROLES.CLOCKER) {
      if (assignedGroups?.includes(resourceType)) {
        return true;
      }
    }

    // Check hierarchy-based permissions
    return this.checkHierarchyPermission(userRole, permission, context);
  }

  /**
   * Check hierarchy-based permissions
   * @param {string} userRole - User's role
   * @param {string} permission - Permission to check
   * @param {Object} context - Context object
   * @returns {boolean} - Whether user has hierarchical permission
   */
  checkHierarchyPermission(userRole, permission, context) {
    const userLevel = this.roleHierarchy[userRole] || 0;
    const { targetUserRole, minimumRole } = context;

    // Check if user's role is high enough for the minimum required role
    if (minimumRole) {
      const minimumLevel = this.roleHierarchy[minimumRole] || 0;
      return userLevel >= minimumLevel;
    }

    // Check if user can manage target user based on hierarchy
    if (targetUserRole) {
      const targetLevel = this.roleHierarchy[targetUserRole] || 0;
      return userLevel > targetLevel;
    }

    return false;
  }

  /**
   * Get user's effective permissions
   * @param {string} userRole - User's role
   * @param {Object} context - User context
   * @returns {Array} - Array of permissions
   */
  getUserPermissions(userRole, context = {}) {
    const basePermissions = this.permissions[userRole] || [];
    const effectivePermissions = [...basePermissions];

    // Add contextual permissions based on user's departments, assignments, etc.
    if (context.departments?.length > 0) {
      effectivePermissions.push('departments:read:assigned');
    }

    if (context.clockerAssignments?.length > 0) {
      effectivePermissions.push('attendance:mark:assigned');
    }

    return [...new Set(effectivePermissions)]; // Remove duplicates
  }

  /**
   * Check if user can access resource
   * @param {string} userRole - User's role
   * @param {string} resource - Resource name
   * @param {string} action - Action to perform
   * @param {Object} context - Context object
   * @returns {boolean} - Whether user can access resource
   */
  canAccessResource(userRole, resource, action, context = {}) {
    const permission = `${resource}:${action}`;
    return this.hasPermission(userRole, permission, context);
  }

  /**
   * Check department access permissions
   * @param {string} userRole - User's role
   * @param {string} targetDepartment - Department to access
   * @param {Array} userDepartments - User's departments
   * @returns {boolean} - Whether user can access department
   */
  canAccessDepartment(userRole, targetDepartment, userDepartments = []) {
    // Super Admin and Senior Pastor can access all departments
    if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR].includes(userRole)) {
      return true;
    }

    // Associate Pastor can access most departments
    if (userRole === USER_ROLES.ASSOCIATE_PASTOR) {
      return true;
    }

    // Other roles can only access their assigned departments
    return userDepartments.includes(targetDepartment);
  }

  /**
   * Check event creation permissions with business rules
   * @param {string} userRole - User's role
   * @param {Object} eventData - Event data
   * @param {Object} userContext - User context
   * @returns {Object} - Permission check result
   */
  canCreateEvent(userRole, eventData, userContext) {
    const { departments: userDepartments = [], isActive } = userContext;

    if (!isActive) {
      return { allowed: false, reason: 'User account is not active' };
    }

    // Check basic creation permission
    if (!this.hasPermission(userRole, 'events:create', userContext)) {
      return { allowed: false, reason: 'Insufficient permissions to create events' };
    }

    // Check department-specific rules
    if (eventData.targetDepartments?.length > 0) {
      const canAccessAllDepts = eventData.targetDepartments.every(dept => 
        this.canAccessDepartment(userRole, dept, userDepartments)
      );

      if (!canAccessAllDepts) {
        return { allowed: false, reason: 'Cannot create events for departments you do not manage' };
      }
    }

    // Check role-specific restrictions
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      // Department leaders can only create events for their departments
      if (!eventData.targetDepartments?.some(dept => userDepartments.includes(dept))) {
        return { allowed: false, reason: 'Department leaders must include their department in events' };
      }
    }

    return { allowed: true };
  }

  /**
   * Check attendance marking permissions with context
   * @param {string} userRole - User's role
   * @param {Object} attendanceData - Attendance data
   * @param {Object} userContext - User context
   * @returns {Object} - Permission check result
   */
  canMarkAttendance(userRole, attendanceData, userContext) {
    const { clockerAssignments = [], departments = [] } = userContext;

    // Check basic permission
    if (!this.hasPermission(userRole, 'attendance:mark', userContext)) {
      return { allowed: false, reason: 'No permission to mark attendance' };
    }

    // Clocker-specific restrictions
    if (userRole === USER_ROLES.CLOCKER) {
      const { eventId, targetGroups } = attendanceData;
      
      // Check if clocker is assigned to this event/group
      const hasAssignment = clockerAssignments.some(assignment => 
        assignment.eventId === eventId || 
        targetGroups?.some(group => assignment.groups?.includes(group))
      );

      if (!hasAssignment) {
        return { allowed: false, reason: 'Not assigned to mark attendance for this event/group' };
      }
    }

    return { allowed: true };
  }

  /**
   * Get user's accessible departments based on role
   * @param {string} userRole - User's role
   * @param {Array} userDepartments - User's assigned departments
   * @returns {Object} - Access scope information
   */
  getDepartmentAccessScope(userRole, userDepartments = []) {
    switch (userRole) {
      case USER_ROLES.SUPER_ADMIN:
      case USER_ROLES.SENIOR_PASTOR:
        return { scope: 'all', departments: [] };
      
      case USER_ROLES.ASSOCIATE_PASTOR:
        return { scope: 'most', departments: [] }; // Can access most departments
      
      case USER_ROLES.PASTOR:
      case USER_ROLES.DEPARTMENT_LEADER:
        return { scope: 'assigned', departments: userDepartments };
      
      case USER_ROLES.CLOCKER:
        return { scope: 'assigned_groups', departments: userDepartments };
      
      case USER_ROLES.MEMBER:
      default:
        return { scope: 'none', departments: [] };
    }
  }

  /**
   * Validate role assignment permissions
   * @param {string} assignerRole - Role of user making assignment
   * @param {string} targetRole - Role being assigned
   * @returns {boolean} - Whether assignment is allowed
   */
  canAssignRole(assignerRole, targetRole) {
    const assignerLevel = this.roleHierarchy[assignerRole] || 0;
    const targetLevel = this.roleHierarchy[targetRole] || 0;

    // Can only assign roles lower than your own
    return assignerLevel > targetLevel;
  }

  /**
   * Get permission summary for user
   * @param {string} userRole - User's role
   * @param {Object} context - User context
   * @returns {Object} - Permission summary
   */
  getPermissionSummary(userRole, context = {}) {
    const permissions = this.getUserPermissions(userRole, context);
    const departmentAccess = this.getDepartmentAccessScope(userRole, context.departments);
    
    return {
      role: userRole,
      level: this.roleHierarchy[userRole] || 0,
      permissions: permissions,
      departmentAccess: departmentAccess,
      canManageUsers: this.hasPermission(userRole, 'users:create'),
      canManageEvents: this.hasPermission(userRole, 'events:create'),
      canViewReports: this.hasPermission(userRole, 'reports:read'),
      canMarkAttendance: this.hasPermission(userRole, 'attendance:mark'),
      lastUpdated: new Date()
    };
  }
}

// Export singleton instance
const permissionSystem = new PermissionSystem();

module.exports = {
  // Main permission checking functions
  hasPermission: (userRole, permission, context = {}) => 
    permissionSystem.hasPermission(userRole, permission, context),
  
  canAccessResource: (userRole, resource, action, context = {}) =>
    permissionSystem.canAccessResource(userRole, resource, action, context),
  
  canAccessDepartment: (userRole, targetDepartment, userDepartments = []) =>
    permissionSystem.canAccessDepartment(userRole, targetDepartment, userDepartments),
  
  // Business rule checkers
  canCreateEvent: (userRole, eventData, userContext) =>
    permissionSystem.canCreateEvent(userRole, eventData, userContext),
  
  canMarkAttendance: (userRole, attendanceData, userContext) =>
    permissionSystem.canMarkAttendance(userRole, attendanceData, userContext),
  
  canAssignRole: (assignerRole, targetRole) =>
    permissionSystem.canAssignRole(assignerRole, targetRole),
  
  // Utility functions
  getUserPermissions: (userRole, context = {}) =>
    permissionSystem.getUserPermissions(userRole, context),
  
  getDepartmentAccessScope: (userRole, userDepartments = []) =>
    permissionSystem.getDepartmentAccessScope(userRole, userDepartments),
  
  getPermissionSummary: (userRole, context = {}) =>
    permissionSystem.getPermissionSummary(userRole, context),
  
  // Constants and mappings
  ROLE_HIERARCHY: permissionSystem.roleHierarchy,
  PERMISSIONS: permissionSystem.permissions,
  RESOURCE_PERMISSIONS: permissionSystem.resourcePermissions,
  
  // Permission system instance for advanced usage
  permissionSystem
}; 
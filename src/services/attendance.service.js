// Attendance Service
// Handles attendance marking, updates, closure, history, and bulk operations

const Attendance = require('../models/Attendance.model');
const Event = require('../models/Event.model');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
const { 
  USER_ROLES, 
  ATTENDANCE_STATUS,
  EVENT_STATUS,
  ROLE_HIERARCHY,
  ERROR_CODES, 
  AUDIT_ACTIONS,
  SUCCESS_MESSAGES 
} = require('../utils/constants');
const mongoose = require('mongoose');

class AttendanceService {
  /**
   * Mark attendance for a single user
   */
  async markAttendance(attendanceData, markedBy, markedByRole, ipAddress) {
    const { eventId, userId, status, notes, location } = attendanceData;

    // Validate event
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check if event is active or recently ended
    if (!this.canMarkAttendanceForEvent(event)) {
      throw ApiError.badRequest(
        'Cannot mark attendance for this event. Event must be active or recently ended.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Validate user
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Check permissions
    if (!this.canMarkAttendanceForUser(markedBy, markedByRole, userId, event)) {
      throw ApiError.forbidden(
        'Insufficient permissions to mark attendance for this user',
        ERROR_CODES.ACCESS_DENIED
      );
    }

    // Check for existing attendance record
    const existingAttendance = await Attendance.findOne({ eventId, userId });

    if (existingAttendance) {
      // Update existing attendance
      const previousStatus = existingAttendance.status;
      
      existingAttendance.status = status;
      existingAttendance.notes = notes;
      existingAttendance.location = location;
      existingAttendance.markedBy = markedBy;
      existingAttendance.markedAt = new Date();
      existingAttendance.updatedAt = new Date();

      await existingAttendance.save();

      // Log attendance update
      await AuditLog.logAction({
        userId: markedBy,
        action: AUDIT_ACTIONS.ATTENDANCE_UPDATE,
        resource: 'attendance',
        resourceId: existingAttendance._id,
        details: {
          eventId,
          userId,
          previousStatus,
          newStatus: status,
          notes
        },
        ipAddress,
        result: { success: true }
      });

      return await this.getAttendanceById(existingAttendance._id);
    } else {
      // Create new attendance record
      const attendance = new Attendance({
        eventId,
        userId,
        status,
        notes,
        location,
        markedBy,
        markedAt: new Date()
      });

      await attendance.save();

      // Log attendance creation
      await AuditLog.logAction({
        userId: markedBy,
        action: AUDIT_ACTIONS.ATTENDANCE_MARK,
        resource: 'attendance',
        resourceId: attendance._id,
        details: {
          eventId,
          userId,
          status,
          notes
        },
        ipAddress,
        result: { success: true }
      });

      return await this.getAttendanceById(attendance._id);
    }
  }

  /**
   * Mark attendance for multiple users (bulk operation)
   */
  async markBulkAttendance(bulkData, markedBy, markedByRole, ipAddress) {
    const { eventId, attendanceRecords } = bulkData;

    // Validate event
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    if (!this.canMarkAttendanceForEvent(event)) {
      throw ApiError.badRequest(
        'Cannot mark attendance for this event',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Check bulk operation permissions
    if (!this.canPerformBulkOperations(markedBy, markedByRole, event)) {
      throw ApiError.forbidden(
        'Insufficient permissions for bulk attendance operations',
        ERROR_CODES.ACCESS_DENIED
      );
    }

    const results = {
      successful: [],
      failed: [],
      updated: []
    };

    // Process each attendance record
    for (const record of attendanceRecords) {
      try {
        const { userId, status, notes, location } = record;

        // Validate user exists
        const user = await User.findById(userId);
        if (!user) {
          results.failed.push({
            userId,
            reason: 'User not found'
          });
          continue;
        }

        // Check individual permissions
        if (!this.canMarkAttendanceForUser(markedBy, markedByRole, userId, event)) {
          results.failed.push({
            userId,
            reason: 'Insufficient permissions'
          });
          continue;
        }

        // Check for existing attendance
        const existingAttendance = await Attendance.findOne({ eventId, userId });

        if (existingAttendance) {
          // Update existing
          const previousStatus = existingAttendance.status;
          existingAttendance.status = status;
          existingAttendance.notes = notes;
          existingAttendance.location = location;
          existingAttendance.markedBy = markedBy;
          existingAttendance.markedAt = new Date();
          existingAttendance.updatedAt = new Date();

          await existingAttendance.save();

          results.updated.push({
            userId,
            attendanceId: existingAttendance._id,
            previousStatus,
            newStatus: status,
            userName: user.fullName
          });
        } else {
          // Create new
          const attendance = new Attendance({
            eventId,
            userId,
            status,
            notes,
            location,
            markedBy,
            markedAt: new Date()
          });

          await attendance.save();

          results.successful.push({
            userId,
            attendanceId: attendance._id,
            status,
            userName: user.fullName
          });
        }

      } catch (error) {
        results.failed.push({
          userId: record.userId,
          reason: error.message
        });
      }
    }

    // Log bulk attendance operation
    await AuditLog.logAction({
      userId: markedBy,
      action: AUDIT_ACTIONS.ATTENDANCE_BULK_MARK,
      resource: 'attendance',
      resourceId: eventId,
      details: {
        eventId,
        totalRecords: attendanceRecords.length,
        successful: results.successful.length,
        updated: results.updated.length,
        failed: results.failed.length
      },
      ipAddress,
      result: { success: true }
    });

    return results;
  }

  /**
   * Get attendance by ID with full details
   */
  async getAttendanceById(attendanceId) {
    const attendance = await Attendance.findById(attendanceId)
      .populate('eventId', 'title startTime endTime status')
      .populate('userId', 'fullName phoneNumber role')
      .populate('markedBy', 'fullName role');

    if (!attendance) {
      throw ApiError.notFound('Attendance record not found', ERROR_CODES.ATTENDANCE_NOT_FOUND);
    }

    return attendance;
  }

  /**
   * Get attendance records with filtering
   */
  async getAttendanceRecords(filters = {}, options = {}) {
    const {
      page = 1,
      limit = 50,
      sort = '-markedAt',
      eventId,
      userId,
      status,
      startDate,
      endDate,
      includeEventDetails = false,
      includeUserDetails = false
    } = options;

    const query = {};

    // Apply filters
    if (eventId) query.eventId = eventId;
    if (userId) query.userId = userId;
    if (status) query.status = status;

    // Date range filtering
    if (startDate || endDate) {
      query.markedAt = {};
      if (startDate) query.markedAt.$gte = new Date(startDate);
      if (endDate) query.markedAt.$lte = new Date(endDate);
    }

    // Apply role-based access control
    if (filters.scopedAccess) {
      const scopedQuery = await this.applyScopedAccess(filters.currentUserId, filters.currentUserRole);
      Object.assign(query, scopedQuery);
    }

    const skip = (page - 1) * limit;

    let attendanceQuery = Attendance.find(query);

    // Add population based on options
    if (includeEventDetails) {
      attendanceQuery = attendanceQuery.populate('eventId', 'title startTime endTime status location');
    }

    if (includeUserDetails) {
      attendanceQuery = attendanceQuery.populate('userId', 'fullName phoneNumber role');
    }

    attendanceQuery = attendanceQuery
      .populate('markedBy', 'fullName role')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const [records, total] = await Promise.all([
      attendanceQuery.exec(),
      Attendance.countDocuments(query)
    ]);

    return {
      records,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get attendance statistics for an event
   */
  async getEventAttendanceStats(eventId, options = {}) {
    const { includeBreakdown = true, includeTrends = false } = options;

    // Basic statistics
    const stats = await Attendance.aggregate([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          users: { $push: '$userId' }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === ATTENDANCE_STATUS.PRESENT)?.count || 0;
    const absent = stats.find(s => s._id === ATTENDANCE_STATUS.ABSENT)?.count || 0;
    const late = stats.find(s => s._id === ATTENDANCE_STATUS.LATE)?.count || 0;
    const excused = stats.find(s => s._id === ATTENDANCE_STATUS.EXCUSED)?.count || 0;

    const result = {
      eventId,
      total,
      present,
      absent,
      late,
      excused,
      attendanceRate: total > 0 ? parseFloat(((present + late) / total * 100).toFixed(2)) : 0,
      presentRate: total > 0 ? parseFloat((present / total * 100).toFixed(2)) : 0
    };

    // Add detailed breakdown if requested
    if (includeBreakdown) {
      result.breakdown = stats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          percentage: total > 0 ? parseFloat((stat.count / total * 100).toFixed(2)) : 0,
          users: stat.users
        };
        return acc;
      }, {});
    }

    // Add trends if requested
    if (includeTrends) {
      result.trends = await this.getAttendanceTrends(eventId);
    }

    return result;
  }

  /**
   * Get attendance statistics for a user
   */
  async getUserAttendanceStats(userId, options = {}) {
    const { 
      timeframe = 90, 
      eventType,
      departmentId,
      includeHistory = false 
    } = options;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Build match conditions
    const matchConditions = {
      userId: new mongoose.Types.ObjectId(userId),
      markedAt: { $gte: startDate }
    };

    // Add event filtering through lookup
    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'events',
          localField: 'eventId',
          foreignField: '_id',
          as: 'event'
        }
      },
      { $unwind: '$event' }
    ];

    // Add event filters
    if (eventType) {
      pipeline.push({ $match: { 'event.eventType': eventType } });
    }

    if (departmentId) {
      pipeline.push({ $match: { 'event.departmentId': new mongoose.Types.ObjectId(departmentId) } });
    }

    // Group by status
    pipeline.push({
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        events: { $push: { eventId: '$eventId', eventTitle: '$event.title', markedAt: '$markedAt' } }
      }
    });

    const stats = await Attendance.aggregate(pipeline);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === ATTENDANCE_STATUS.PRESENT)?.count || 0;
    const absent = stats.find(s => s._id === ATTENDANCE_STATUS.ABSENT)?.count || 0;
    const late = stats.find(s => s._id === ATTENDANCE_STATUS.LATE)?.count || 0;
    const excused = stats.find(s => s._id === ATTENDANCE_STATUS.EXCUSED)?.count || 0;

    const result = {
      userId,
      period: { days: timeframe, startDate },
      total,
      present,
      absent,
      late,
      excused,
      attendanceRate: total > 0 ? parseFloat(((present + late) / total * 100).toFixed(2)) : 0,
      punctualityRate: total > 0 ? parseFloat((present / (present + late) * 100).toFixed(2)) : 0
    };

    // Add detailed history if requested
    if (includeHistory) {
      result.history = stats.reduce((acc, stat) => {
        acc[stat._id] = stat.events.map(event => ({
          eventId: event.eventId,
          eventTitle: event.eventTitle,
          markedAt: event.markedAt
        }));
        return acc;
      }, {});
    }

    return result;
  }

  /**
   * Get attendance dashboard data
   */
  async getAttendanceDashboard(userId, userRole, options = {}) {
    const { timeframe = 30, includeCharts = true } = options;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Apply scoped access
    const scopedQuery = await this.applyScopedAccess(userId, userRole);

    // Get overall statistics
    const overallStats = await this.getOverallAttendanceStats(scopedQuery, startDate);

    // Get recent attendance activity
    const recentActivity = await this.getRecentAttendanceActivity(scopedQuery, 20);

    // Get top attendees
    const topAttendees = await this.getTopAttendees(scopedQuery, startDate, 10);

    // Get events with low attendance
    const lowAttendanceEvents = await this.getLowAttendanceEvents(scopedQuery, startDate);

    const dashboard = {
      period: { days: timeframe, startDate },
      overview: overallStats,
      recentActivity,
      topAttendees,
      alerts: {
        lowAttendanceEvents
      }
    };

    // Add charts data if requested
    if (includeCharts) {
      dashboard.charts = {
        attendanceTrend: await this.getAttendanceTrendChart(scopedQuery, startDate),
        statusDistribution: await this.getStatusDistributionChart(scopedQuery, startDate),
        departmentComparison: await this.getDepartmentComparisonChart(scopedQuery, startDate)
      };
    }

    return dashboard;
  }

  /**
   * Export attendance data
   */
  async exportAttendanceData(filters, format = 'json') {
    const { eventId, userId, startDate, endDate, departmentId } = filters;

    const matchConditions = {};
    if (eventId) matchConditions.eventId = new mongoose.Types.ObjectId(eventId);
    if (userId) matchConditions.userId = new mongoose.Types.ObjectId(userId);
    if (startDate || endDate) {
      matchConditions.markedAt = {};
      if (startDate) matchConditions.markedAt.$gte = new Date(startDate);
      if (endDate) matchConditions.markedAt.$lte = new Date(endDate);
    }

    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'events',
          localField: 'eventId',
          foreignField: '_id',
          as: 'event'
        }
      },
      { $unwind: '$event' },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'users',
          localField: 'markedBy',
          foreignField: '_id',
          as: 'marker'
        }
      },
      { $unwind: { path: '$marker', preserveNullAndEmptyArrays: true } }
    ];

    // Add department filter if specified
    if (departmentId) {
      pipeline.push({
        $match: { 'event.departmentId': new mongoose.Types.ObjectId(departmentId) }
      });
    }

    // Project the required fields
    pipeline.push({
      $project: {
        eventTitle: '$event.title',
        eventDate: '$event.startTime',
        eventType: '$event.eventType',
        userName: '$user.fullName',
        userPhone: '$user.phoneNumber',
        userRole: '$user.role',
        attendanceStatus: '$status',
        markedAt: '$markedAt',
        markedBy: '$marker.fullName',
        notes: '$notes',
        location: '$location'
      }
    });

    pipeline.push({ $sort: { eventDate: -1, userName: 1 } });

    const data = await Attendance.aggregate(pipeline);

    // Format based on requested format
    if (format === 'csv') {
      return this.formatAsCSV(data);
    }

    return data;
  }

  /**
   * Generate attendance report
   */
  async generateAttendanceReport(reportConfig) {
    const {
      type, // 'event', 'user', 'department', 'summary'
      targetId,
      startDate,
      endDate,
      includeStats = true,
      includeCharts = false
    } = reportConfig;

    switch (type) {
      case 'event':
        return this.generateEventAttendanceReport(targetId, { startDate, endDate, includeStats, includeCharts });
      
      case 'user':
        return this.generateUserAttendanceReport(targetId, { startDate, endDate, includeStats, includeCharts });
      
      case 'department':
        return this.generateDepartmentAttendanceReport(targetId, { startDate, endDate, includeStats, includeCharts });
      
      case 'summary':
        return this.generateSummaryAttendanceReport({ startDate, endDate, includeStats, includeCharts });
      
      default:
        throw ApiError.badRequest('Invalid report type', ERROR_CODES.INVALID_INPUT);
    }
  }

  // Helper methods
  canMarkAttendanceForEvent(event) {
    // Can mark attendance for active events or events that ended recently (within auto-close window)
    const now = new Date();
    const eventEndTime = new Date(event.endTime);
    const autoCloseWindow = event.autoCloseAfterHours || 3; // hours
    const cutoffTime = new Date(eventEndTime.getTime() + (autoCloseWindow * 60 * 60 * 1000));

    return (
      event.status === EVENT_STATUS.ACTIVE ||
      (event.status === EVENT_STATUS.UPCOMING && eventEndTime <= now) ||
      (event.status === EVENT_STATUS.COMPLETED && now <= cutoffTime)
    );
  }

  canMarkAttendanceForUser(markedBy, markedByRole, userId, event) {
    // Self attendance marking
    if (markedBy.toString() === userId.toString()) {
      return true;
    }

    // High-level roles can mark attendance for anyone
    if (ROLE_HIERARCHY[markedByRole] >= ROLE_HIERARCHY[USER_ROLES.PASTOR]) {
      return true;
    }

    // Clockers can mark attendance for events in their scope
    if (markedByRole === USER_ROLES.CLOCKER) {
      return event.assignedClockerId?.toString() === markedBy.toString();
    }

    // Department leaders can mark attendance for their department members
    if (markedByRole === USER_ROLES.DEPARTMENT_LEADER) {
      // This would require additional logic to check if user is in marker's department
      return true; // Simplified for now
    }

    return false;
  }

  canPerformBulkOperations(userId, userRole, event) {
    // High-level roles can perform bulk operations
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.PASTOR]) {
      return true;
    }

    // Clockers can perform bulk operations for their assigned events
    if (userRole === USER_ROLES.CLOCKER) {
      return event.assignedClockerId?.toString() === userId.toString();
    }

    // Department leaders can perform bulk operations for their department events
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      return true; // Simplified for now
    }

    return false;
  }

  async applyScopedAccess(userId, userRole) {
    const query = {};

    // High-level roles can see all attendance
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return query;
    }

    // Department leaders can see their department's attendance
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      // Get events from user's department
      const user = await User.findById(userId).populate('departmentId');
      if (user?.departmentId) {
        const departmentEvents = await Event.find({ departmentId: user.departmentId._id }).distinct('_id');
        query.eventId = { $in: departmentEvents };
      }
      return query;
    }

    // Clockers can see attendance for their assigned events
    if (userRole === USER_ROLES.CLOCKER) {
      const assignedEvents = await Event.find({ assignedClockerId: userId }).distinct('_id');
      query.eventId = { $in: assignedEvents };
      return query;
    }

    // Members can only see their own attendance
    query.userId = new mongoose.Types.ObjectId(userId);
    return query;
  }

  async getAttendanceTrends(eventId) {
    // Get attendance over time for similar events
    const event = await Event.findById(eventId);
    if (!event) return null;

    const similarEvents = await Event.find({
      eventType: event.eventType,
      departmentId: event.departmentId,
      createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
    }).distinct('_id');

    const trends = await Attendance.aggregate([
      { $match: { eventId: { $in: similarEvents } } },
      {
        $group: {
          _id: {
            eventId: '$eventId',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.eventId',
          statusCounts: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          }
        }
      }
    ]);

    return trends;
  }

  async getOverallAttendanceStats(scopedQuery, startDate) {
    const stats = await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === ATTENDANCE_STATUS.PRESENT)?.count || 0;

    return {
      total,
      present,
      absent: stats.find(s => s._id === ATTENDANCE_STATUS.ABSENT)?.count || 0,
      late: stats.find(s => s._id === ATTENDANCE_STATUS.LATE)?.count || 0,
      excused: stats.find(s => s._id === ATTENDANCE_STATUS.EXCUSED)?.count || 0,
      attendanceRate: total > 0 ? parseFloat(((present) / total * 100).toFixed(2)) : 0
    };
  }

  async getRecentAttendanceActivity(scopedQuery, limit = 20) {
    return await Attendance.find(scopedQuery)
      .populate('eventId', 'title startTime')
      .populate('userId', 'fullName role')
      .populate('markedBy', 'fullName role')
      .sort('-markedAt')
      .limit(limit);
  }

  async getTopAttendees(scopedQuery, startDate, limit = 10) {
    return await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate },
          status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE] }
        }
      },
      {
        $group: {
          _id: '$userId',
          attendanceCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          userName: '$user.fullName',
          userRole: '$user.role',
          attendanceCount: 1
        }
      },
      { $sort: { attendanceCount: -1 } },
      { $limit: limit }
    ]);
  }

  async getLowAttendanceEvents(scopedQuery, startDate) {
    const lowAttendanceThreshold = 0.5; // 50% attendance rate

    return await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventId',
          total: { $sum: 1 },
          present: {
            $sum: {
              $cond: [
                { $in: ['$status', [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE]] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $addFields: {
          attendanceRate: { $divide: ['$present', '$total'] }
        }
      },
      {
        $match: {
          attendanceRate: { $lt: lowAttendanceThreshold }
        }
      },
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: '_id',
          as: 'event'
        }
      },
      { $unwind: '$event' },
      {
        $project: {
          eventId: '$_id',
          eventTitle: '$event.title',
          eventDate: '$event.startTime',
          totalAttendees: '$total',
          presentCount: '$present',
          attendanceRate: { $multiply: ['$attendanceRate', 100] }
        }
      },
      { $sort: { attendanceRate: 1 } },
      { $limit: 10 }
    ]);
  }

  async getAttendanceTrendChart(scopedQuery, startDate) {
    const dailyStats = await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$markedAt' } },
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return dailyStats;
  }

  async getStatusDistributionChart(scopedQuery, startDate) {
    return await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
  }

  async getDepartmentComparisonChart(scopedQuery, startDate) {
    return await Attendance.aggregate([
      {
        $match: {
          ...scopedQuery,
          markedAt: { $gte: startDate }
        }
      },
      {
        $lookup: {
          from: 'events',
          localField: 'eventId',
          foreignField: '_id',
          as: 'event'
        }
      },
      { $unwind: '$event' },
      {
        $lookup: {
          from: 'departments',
          localField: 'event.departmentId',
          foreignField: '_id',
          as: 'department'
        }
      },
      { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            departmentId: '$department._id',
            departmentName: '$department.name',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: {
            departmentId: '$_id.departmentId',
            departmentName: '$_id.departmentName'
          },
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          }
        }
      }
    ]);
  }

  formatAsCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  async generateEventAttendanceReport(eventId, options) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    const stats = await this.getEventAttendanceStats(eventId, options);
    const records = await this.getAttendanceRecords({}, { eventId, includeUserDetails: true });

    return {
      event: {
        id: event._id,
        title: event.title,
        date: event.startTime,
        type: event.eventType,
        status: event.status
      },
      statistics: stats,
      records: records.records,
      generatedAt: new Date()
    };
  }

  async generateUserAttendanceReport(userId, options) {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    const stats = await this.getUserAttendanceStats(userId, options);
    const records = await this.getAttendanceRecords({}, { userId, includeEventDetails: true });

    return {
      user: {
        id: user._id,
        name: user.fullName,
        role: user.role,
        phone: user.phoneNumber
      },
      statistics: stats,
      records: records.records,
      generatedAt: new Date()
    };
  }

  async generateDepartmentAttendanceReport(departmentId, options) {
    const Department = require('../models/Department.model');
    const department = await Department.findById(departmentId);
    if (!department) {
      throw ApiError.notFound('Department not found', ERROR_CODES.DEPARTMENT_NOT_FOUND);
    }

    // Get department events
    const departmentEvents = await Event.find({ departmentId }).distinct('_id');
    
    // Get aggregate stats
    const stats = await Attendance.aggregate([
      { $match: { eventId: { $in: departmentEvents } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    return {
      department: {
        id: department._id,
        name: department.name,
        category: department.category
      },
      statistics: stats,
      generatedAt: new Date()
    };
  }

  async generateSummaryAttendanceReport(options) {
    const { startDate, endDate } = options;
    const dateFilter = {};
    
    if (startDate) dateFilter.markedAt = { $gte: new Date(startDate) };
    if (endDate) {
      dateFilter.markedAt = dateFilter.markedAt || {};
      dateFilter.markedAt.$lte = new Date(endDate);
    }

    const overallStats = await Attendance.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const eventStats = await Attendance.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$eventId',
          totalAttendance: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          avgAttendancePerEvent: { $avg: '$totalAttendance' }
        }
      }
    ]);

    return {
      period: { startDate, endDate },
      overallStatistics: overallStats,
      eventStatistics: eventStats[0] || { totalEvents: 0, avgAttendancePerEvent: 0 },
      generatedAt: new Date()
    };
  }

  /**
   * Get attendance statistics based on various grouping options
   */
  async getAttendanceStatistics(userId, userRole, options = {}) {
    const { startDate, endDate, groupBy, departmentId, eventType } = options;
    
    // Build base query with scoped access
    const scopedQuery = await this.applyScopedAccess(userId, userRole);
    
    // Add date filters
    if (startDate || endDate) {
      scopedQuery.markedAt = {};
      if (startDate) scopedQuery.markedAt.$gte = new Date(startDate);
      if (endDate) scopedQuery.markedAt.$lte = new Date(endDate);
    }
    
    // Add department filter if provided
    if (departmentId) {
      const departmentEvents = await Event.find({ departmentId }).distinct('_id');
      scopedQuery.eventId = { $in: departmentEvents };
    }
    
    // Add event type filter if provided
    if (eventType) {
      const typeEvents = await Event.find({ eventType }).distinct('_id');
      if (scopedQuery.eventId) {
        scopedQuery.eventId.$in = scopedQuery.eventId.$in.filter(id => 
          typeEvents.some(typeId => typeId.toString() === id.toString())
        );
      } else {
        scopedQuery.eventId = { $in: typeEvents };
      }
    }
    
    // Perform aggregation based on groupBy parameter
    let aggregationPipeline = [{ $match: scopedQuery }];
    
    switch (groupBy) {
      case 'status':
        aggregationPipeline.push(
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        );
        break;
        
      case 'event':
        aggregationPipeline.push(
          {
            $group: {
              _id: '$eventId',
              statuses: {
                $push: '$status'
              },
              total: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'events',
              localField: '_id',
              foreignField: '_id',
              as: 'event'
            }
          },
          { $unwind: '$event' },
          {
            $project: {
              eventId: '$_id',
              eventTitle: '$event.title',
              eventDate: '$event.startTime',
              eventType: '$event.eventType',
              total: 1,
              present: {
                $size: {
                  $filter: {
                    input: '$statuses',
                    as: 'status',
                    cond: { $eq: ['$$status', ATTENDANCE_STATUS.PRESENT] }
                  }
                }
              },
              absent: {
                $size: {
                  $filter: {
                    input: '$statuses',
                    as: 'status',
                    cond: { $eq: ['$$status', ATTENDANCE_STATUS.ABSENT] }
                  }
                }
              }
            }
          },
          { $sort: { eventDate: -1 } }
        );
        break;
        
      case 'department':
        aggregationPipeline.push(
          {
            $lookup: {
              from: 'events',
              localField: 'eventId',
              foreignField: '_id',
              as: 'event'
            }
          },
          { $unwind: '$event' },
          {
            $lookup: {
              from: 'departments',
              localField: 'event.departmentId',
              foreignField: '_id',
              as: 'department'
            }
          },
          { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: {
                departmentId: '$department._id',
                departmentName: '$department.name',
                status: '$status'
              },
              count: { $sum: 1 }
            }
          },
          {
            $group: {
              _id: {
                departmentId: '$_id.departmentId',
                departmentName: '$_id.departmentName'
              },
              statuses: {
                $push: {
                  status: '$_id.status',
                  count: '$count'
                }
              },
              total: { $sum: '$count' }
            }
          },
          {
            $project: {
              departmentId: '$_id.departmentId',
              departmentName: '$_id.departmentName',
              total: 1,
              statuses: 1
            }
          }
        );
        break;
        
      case 'user':
        aggregationPipeline.push(
          {
            $group: {
              _id: {
                userId: '$userId',
                status: '$status'
              },
              count: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: '_id.userId',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: '$user' },
          {
            $group: {
              _id: '$_id.userId',
              userName: { $first: '$user.fullName' },
              userRole: { $first: '$user.role' },
              statuses: {
                $push: {
                  status: '$_id.status',
                  count: '$count'
                }
              },
              total: { $sum: '$count' }
            }
          },
          { $sort: { total: -1 } },
          { $limit: 50 }
        );
        break;
        
      default:
        // Overall statistics
        aggregationPipeline.push(
          {
            $facet: {
              byStatus: [
                {
                  $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                  }
                }
              ],
              summary: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' },
                    uniqueEvents: { $addToSet: '$eventId' }
                  }
                },
                {
                  $project: {
                    total: 1,
                    uniqueUsers: { $size: '$uniqueUsers' },
                    uniqueEvents: { $size: '$uniqueEvents' }
                  }
                }
              ]
            }
          }
        );
    }
    
    const results = await Attendance.aggregate(aggregationPipeline);
    
    return {
      groupBy,
      filters: { startDate, endDate, departmentId, eventType },
      data: results
    };
  }
}

module.exports = new AttendanceService(); 
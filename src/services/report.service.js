const Attendance = require('../models/Attendance.model');
const Event = require('../models/Event.model');
const User = require('../models/User.model');
const Department = require('../models/Department.model');
const Ministry = require('../models/Ministry.model');
const PrayerTribe = require('../models/PrayerTribe.model');
const Notification = require('../models/Notification.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
const { 
  USER_ROLES, 
  ATTENDANCE_STATUS,
  EVENT_STATUS,
  ROLE_HIERARCHY,
  ERROR_CODES 
} = require('../utils/constants');
const mongoose = require('mongoose');
const AttendanceService = require('./attendance.service');
const EventService = require('./event.service');
const DepartmentService = require('./department.service');

class ReportService {
  /**
   * Generate comprehensive attendance summary report
   */
  async getAttendanceSummary(filters = {}, options = {}) {
    const {
      timeframe = 30,
      departmentId,
      ministryId,
      eventType,
      includeDetails = false,
      groupBy = 'week' // week, month, event
    } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Build base query
    const matchConditions = {
      markedAt: { $gte: startDate, $lte: endDate }
    };

    // Apply filters
    if (filters.scopedAccess) {
      const scopedQuery = await this.applyScopedAccess(filters.userId, filters.userRole);
      Object.assign(matchConditions, scopedQuery);
    }

    // Get overall statistics
    const overallStats = await this.getOverallAttendanceStats(matchConditions, startDate, endDate);

    // Get trending data
    const trendingData = await this.getAttendanceTrends(matchConditions, groupBy, startDate, endDate);

    // Get department breakdown
    const departmentBreakdown = await this.getDepartmentAttendanceBreakdown(matchConditions);

    // Get event type analysis
    const eventTypeAnalysis = await this.getEventTypeAttendanceAnalysis(matchConditions);

    // Get top performers
    const topPerformers = await this.getTopAttendees(matchConditions, 10);

    // Get attendance patterns
    const patterns = await this.getAttendancePatterns(matchConditions);

    const summary = {
      period: { startDate, endDate, days: timeframe },
      overview: overallStats,
      trends: trendingData,
      breakdown: {
        byDepartment: departmentBreakdown,
        byEventType: eventTypeAnalysis
      },
      topPerformers,
      patterns,
      generatedAt: new Date()
    };

    if (includeDetails) {
      summary.details = await this.getDetailedAttendanceRecords(matchConditions);
    }

    return summary;
  }

  /**
   * Generate member analytics report
   */
  async getMemberAnalytics(filters = {}, options = {}) {
    const {
      timeframe = 90,
      includeInactive = false,
      departmentId,
      ministryId,
      role
    } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Build member query
    const memberQuery = { isActive: true };
    if (includeInactive) delete memberQuery.isActive;
    if (departmentId) memberQuery.departmentId = departmentId;
    if (ministryId) memberQuery.ministryId = ministryId;
    if (role) memberQuery.role = role;

    // Apply scoped access
    if (filters.scopedAccess) {
      const scopedQuery = await this.applyScopedAccess(filters.userId, filters.userRole);
      // Adapt scoped query for member analysis
      if (scopedQuery.departmentId) {
        memberQuery.departmentId = scopedQuery.departmentId;
      }
    }

    // Get member statistics
    const memberStats = await this.getMemberStatistics(memberQuery);

    // Get growth analytics
    const growthAnalytics = await this.getMemberGrowthAnalytics(memberQuery, startDate, endDate);

    // Get engagement analytics
    const engagementAnalytics = await this.getMemberEngagementAnalytics(memberQuery, startDate, endDate);

    // Get role distribution
    const roleDistribution = await this.getRoleDistributionAnalytics(memberQuery);

    // Get department distribution
    const departmentDistribution = await this.getDepartmentDistributionAnalytics(memberQuery);

    // Get attendance behavior analysis
    const attendanceBehavior = await this.getMemberAttendanceBehavior(memberQuery, startDate, endDate);

    return {
      period: { startDate, endDate, days: timeframe },
      overview: memberStats,
      growth: growthAnalytics,
      engagement: engagementAnalytics,
      distribution: {
        byRole: roleDistribution,
        byDepartment: departmentDistribution
      },
      attendanceBehavior,
      generatedAt: new Date()
    };
  }

  /**
   * Generate department performance report
   */
  async getDepartmentPerformance(filters = {}, options = {}) {
    const {
      timeframe = 30,
      includeSubDepartments = true,
      includeComparison = true
    } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Get all departments
    let departments;
    if (filters.scopedAccess && filters.userRole === USER_ROLES.DEPARTMENT_LEADER) {
      // Department leaders see only their department
      const user = await User.findById(filters.userId);
      departments = user.departmentId ? [await Department.findById(user.departmentId)] : [];
    } else {
      departments = await Department.find({ isActive: true });
    }

    const performanceData = [];

    for (const department of departments) {
      const performance = await this.calculateDepartmentPerformance(department._id, startDate, endDate);
      performanceData.push({
        department: {
          id: department._id,
          name: department.name,
          category: department.category,
          leaderId: department.leaderId
        },
        ...performance
      });
    }

    // Sort by performance score
    performanceData.sort((a, b) => b.performanceScore - a.performanceScore);

    // Calculate averages for comparison
    const averages = this.calculatePerformanceAverages(performanceData);

    return {
      period: { startDate, endDate, days: timeframe },
      departments: performanceData,
      averages,
      topPerformer: performanceData[0] || null,
      generatedAt: new Date()
    };
  }

  /**
   * Generate event analytics report
   */
  async getEventAnalytics(filters = {}, options = {}) {
    const {
      timeframe = 60,
      eventType,
      departmentId,
      includeUpcoming = true
    } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Build event query
    const eventQuery = {
      startTime: { $gte: startDate, $lte: endDate }
    };

    if (eventType) eventQuery.eventType = eventType;
    if (departmentId) eventQuery.departmentId = departmentId;

    // Apply scoped access
    if (filters.scopedAccess) {
      const scopedQuery = await this.applyScopedAccess(filters.userId, filters.userRole);
      Object.assign(eventQuery, scopedQuery);
    }

    // Get event statistics
    const eventStats = await EventService.getEventStatistics(filters.userId, filters.userRole, { query: eventQuery });

    // Get attendance analytics for events
    const attendanceAnalytics = await this.getEventAttendanceAnalytics(eventQuery, startDate, endDate);

    // Get event performance metrics
    const performanceMetrics = await this.getEventPerformanceMetrics(eventQuery);

    // Get popular events
    const popularEvents = await this.getPopularEvents(eventQuery, 10);

    // Get event creation trends
    const creationTrends = await this.getEventCreationTrends(eventQuery, startDate, endDate);

    let upcomingEvents = [];
    if (includeUpcoming) {
      upcomingEvents = await this.getUpcomingEventsSummary(filters);
    }

    return {
      period: { startDate, endDate, days: timeframe },
      overview: eventStats,
      attendance: attendanceAnalytics,
      performance: performanceMetrics,
      popularEvents,
      trends: creationTrends,
      upcoming: upcomingEvents,
      generatedAt: new Date()
    };
  }

  /**
   * Export comprehensive report data
   */
  async exportReport(reportType, filters = {}, options = {}) {
    const { format = 'json', includeCharts = false } = options;

    let reportData;
    
    switch (reportType) {
      case 'attendance':
        reportData = await this.getAttendanceSummary(filters, { ...options, includeDetails: true });
        break;
      case 'members':
        reportData = await this.getMemberAnalytics(filters, options);
        break;
      case 'departments':
        reportData = await this.getDepartmentPerformance(filters, options);
        break;
      case 'events':
        reportData = await this.getEventAnalytics(filters, options);
        break;
      case 'comprehensive':
        reportData = await this.getComprehensiveReport(filters, options);
        break;
      default:
        throw ApiError.badRequest('Invalid report type', ERROR_CODES.INVALID_INPUT);
    }

    // Add export metadata
    reportData.export = {
      type: reportType,
      format,
      exportedAt: new Date(),
      exportedBy: filters.userId,
      filters: filters,
      options: options
    };

    if (format === 'csv') {
      return this.convertToCSV(reportData, reportType);
    }

    return reportData;
  }

  /**
   * Generate dashboard summary data
   */
  async getDashboard(userId, userRole, options = {}) {
    const { timeframe = 30 } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    const filters = { scopedAccess: true, userId, userRole };

    // Get key metrics
    const keyMetrics = await this.getKeyMetrics(filters, startDate, endDate);

    // Get recent activity
    const recentActivity = await this.getRecentActivity(filters, 20);

    // Get quick stats
    const quickStats = await this.getQuickStats(filters, startDate, endDate);

    // Get alerts and notifications
    const alerts = await this.getSystemAlerts(filters, startDate, endDate);

    // Get trending data
    const trends = await this.getTrendingData(filters, startDate, endDate);

    return {
      period: { startDate, endDate, days: timeframe },
      keyMetrics,
      quickStats,
      trends,
      recentActivity,
      alerts,
      lastUpdated: new Date()
    };
  }

  // Helper methods for calculations and data processing

  async getOverallAttendanceStats(matchConditions, startDate, endDate) {
    const stats = await Attendance.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = stats.reduce((sum, stat) => sum + stat.count, 0);
    const present = stats.find(s => s._id === ATTENDANCE_STATUS.PRESENT)?.count || 0;
    const late = stats.find(s => s._id === ATTENDANCE_STATUS.LATE)?.count || 0;

    return {
      total,
      present,
      absent: stats.find(s => s._id === ATTENDANCE_STATUS.ABSENT)?.count || 0,
      late,
      excused: stats.find(s => s._id === ATTENDANCE_STATUS.EXCUSED)?.count || 0,
      attendanceRate: total > 0 ? parseFloat(((present + late) / total * 100).toFixed(2)) : 0,
      punctualityRate: (present + late) > 0 ? parseFloat((present / (present + late) * 100).toFixed(2)) : 0
    };
  }

  async getAttendanceTrends(matchConditions, groupBy, startDate, endDate) {
    let groupStage;
    
    switch (groupBy) {
      case 'week':
        groupStage = {
          $group: {
            _id: {
              year: { $year: '$markedAt' },
              week: { $week: '$markedAt' },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        };
        break;
      case 'month':
        groupStage = {
          $group: {
            _id: {
              year: { $year: '$markedAt' },
              month: { $month: '$markedAt' },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        };
        break;
      default: // daily
        groupStage = {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$markedAt' } },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        };
    }

    const trends = await Attendance.aggregate([
      { $match: matchConditions },
      groupStage,
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1, '_id.date': 1 } }
    ]);

    return this.processTrendData(trends, groupBy);
  }

  async getDepartmentAttendanceBreakdown(matchConditions) {
    return await Attendance.aggregate([
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
          statusBreakdown: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      },
      { $sort: { total: -1 } }
    ]);
  }

  async getEventTypeAttendanceAnalysis(matchConditions) {
    return await Attendance.aggregate([
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
        $group: {
          _id: {
            eventType: '$event.eventType',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.eventType',
          statusBreakdown: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      },
      { $sort: { total: -1 } }
    ]);
  }

  async getTopAttendees(matchConditions, limit = 10) {
    return await Attendance.aggregate([
      {
        $match: {
          ...matchConditions,
          status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE] }
        }
      },
      {
        $group: {
          _id: '$userId',
          attendanceCount: { $sum: 1 },
          punctualCount: {
            $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.PRESENT] }, 1, 0] }
          }
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
          attendanceCount: 1,
          punctualCount: 1,
          punctualityRate: {
            $multiply: [{ $divide: ['$punctualCount', '$attendanceCount'] }, 100]
          }
        }
      },
      { $sort: { attendanceCount: -1, punctualityRate: -1 } },
      { $limit: limit }
    ]);
  }

  async getAttendancePatterns(matchConditions) {
    // Analyze patterns by day of week, time of day, etc.
    const dayOfWeekPattern = await Attendance.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $dayOfWeek: '$markedAt' },
          count: { $sum: 1 },
          presentCount: {
            $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.PRESENT] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const hourPattern = await Attendance.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $hour: '$markedAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return {
      byDayOfWeek: dayOfWeekPattern,
      byHour: hourPattern
    };
  }

  async getMemberStatistics(memberQuery) {
    const [total, byRole, byDepartment, growth] = await Promise.all([
      User.countDocuments(memberQuery),
      User.aggregate([
        { $match: memberQuery },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      User.aggregate([
        { $match: memberQuery },
        {
          $lookup: {
            from: 'departments',
            localField: 'departmentId',
            foreignField: '_id',
            as: 'department'
          }
        },
        { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              departmentId: '$department._id',
              departmentName: '$department.name'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      this.getMemberGrowthStats(memberQuery)
    ]);

    return {
      total,
      distribution: {
        byRole,
        byDepartment
      },
      growth
    };
  }

  async getMemberGrowthStats(memberQuery) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newMembers = await User.countDocuments({
      ...memberQuery,
      createdAt: { $gte: thirtyDaysAgo }
    });

    return { newMembers30Days: newMembers };
  }

  async calculateDepartmentPerformance(departmentId, startDate, endDate) {
    // Get department members
    const members = await User.find({ departmentId, isActive: true });
    const memberIds = members.map(m => m._id);

    // Get department events
    const events = await Event.find({
      departmentId,
      startTime: { $gte: startDate, $lte: endDate }
    });

    // Calculate attendance stats
    const attendanceStats = await DepartmentService.calculateDepartmentAttendanceStats(memberIds, {
      createdAt: { $gte: startDate, $lte: endDate }
    });

    // Calculate event stats
    const eventStats = await DepartmentService.calculateDepartmentEventStats(departmentId, {
      startTime: { $gte: startDate, $lte: endDate }
    });

    // Calculate performance score (weighted combination of metrics)
    const performanceScore = this.calculatePerformanceScore({
      attendanceRate: attendanceStats.attendanceRate || 0,
      eventCount: eventStats.total || 0,
      memberCount: members.length || 0,
      eventCompletionRate: eventStats.total > 0 ? (eventStats.completed / eventStats.total * 100) : 0
    });

    return {
      memberCount: members.length,
      attendance: attendanceStats,
      events: eventStats,
      performanceScore
    };
  }

  calculatePerformanceScore(metrics) {
    // Weighted performance score calculation
    const weights = {
      attendanceRate: 0.4,
      eventCount: 0.2,
      memberCount: 0.2,
      eventCompletionRate: 0.2
    };

    // Normalize metrics to 0-100 scale
    const normalized = {
      attendanceRate: Math.min(metrics.attendanceRate, 100),
      eventCount: Math.min(metrics.eventCount * 10, 100), // Assume 10 events = 100%
      memberCount: Math.min(metrics.memberCount * 2, 100), // Assume 50 members = 100%
      eventCompletionRate: Math.min(metrics.eventCompletionRate, 100)
    };

    const score = Object.keys(weights).reduce((total, key) => {
      return total + (normalized[key] * weights[key]);
    }, 0);

    return parseFloat(score.toFixed(2));
  }

  calculatePerformanceAverages(performanceData) {
    if (performanceData.length === 0) return {};

    const totals = performanceData.reduce((acc, dept) => {
      acc.memberCount += dept.memberCount || 0;
      acc.attendanceRate += dept.attendance?.attendanceRate || 0;
      acc.eventCount += dept.events?.total || 0;
      acc.performanceScore += dept.performanceScore || 0;
      return acc;
    }, { memberCount: 0, attendanceRate: 0, eventCount: 0, performanceScore: 0 });

    const count = performanceData.length;

    return {
      avgMemberCount: parseFloat((totals.memberCount / count).toFixed(2)),
      avgAttendanceRate: parseFloat((totals.attendanceRate / count).toFixed(2)),
      avgEventCount: parseFloat((totals.eventCount / count).toFixed(2)),
      avgPerformanceScore: parseFloat((totals.performanceScore / count).toFixed(2))
    };
  }

  async getComprehensiveReport(filters, options) {
    const [attendance, members, departments, events] = await Promise.all([
      this.getAttendanceSummary(filters, options),
      this.getMemberAnalytics(filters, options),
      this.getDepartmentPerformance(filters, options),
      this.getEventAnalytics(filters, options)
    ]);

    return {
      reportType: 'comprehensive',
      attendance,
      members,
      departments,
      events,
      generatedAt: new Date()
    };
  }

  convertToCSV(data, reportType) {
    // Simplified CSV conversion - in production, you'd want a more sophisticated approach
    let csvContent = '';
    
    try {
      if (reportType === 'attendance' && data.details) {
        csvContent = this.attendanceToCSV(data.details);
      } else if (reportType === 'members' && data.distribution) {
        csvContent = this.membersToCSV(data);
      } else {
        // Fallback to JSON stringification
        csvContent = JSON.stringify(data, null, 2);
      }
    } catch (error) {
      csvContent = JSON.stringify(data, null, 2);
    }

    return csvContent;
  }

  attendanceToCSV(attendanceRecords) {
    const headers = ['Event Title', 'User Name', 'Status', 'Marked At', 'Notes'];
    const rows = [headers.join(',')];

    attendanceRecords.forEach(record => {
      const row = [
        record.eventId?.title || 'N/A',
        record.userId?.fullName || 'N/A',
        record.status,
        record.markedAt?.toISOString() || '',
        record.notes || ''
      ].map(field => `"${field}"`);
      rows.push(row.join(','));
    });

    return rows.join('\n');
  }

  async applyScopedAccess(userId, userRole) {
    // Similar to other services - apply role-based access control
    const query = {};

    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return query; // Full access
    }

    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      const user = await User.findById(userId);
      if (user?.departmentId) {
        // For attendance queries through events
        const departmentEvents = await Event.find({ departmentId: user.departmentId }).distinct('_id');
        query.eventId = { $in: departmentEvents };
      }
    }

    return query;
  }

  processTrendData(trends, groupBy) {
    // Process and format trend data for easier consumption
    const processedTrends = {};
    
    trends.forEach(trend => {
      let key;
      if (groupBy === 'week') {
        key = `${trend._id.year}-W${trend._id.week}`;
      } else if (groupBy === 'month') {
        key = `${trend._id.year}-${String(trend._id.month).padStart(2, '0')}`;
      } else {
        key = trend._id.date;
      }

      if (!processedTrends[key]) {
        processedTrends[key] = {};
      }
      processedTrends[key][trend._id.status] = trend.count;
    });

    return processedTrends;
  }

  async getKeyMetrics(filters, startDate, endDate) {
    const attendanceQuery = {};
    if (filters.scopedAccess) {
      Object.assign(attendanceQuery, await this.applyScopedAccess(filters.userId, filters.userRole));
    }
    attendanceQuery.markedAt = { $gte: startDate, $lte: endDate };

    const [totalAttendance, totalEvents, totalMembers, totalNotifications] = await Promise.all([
      Attendance.countDocuments(attendanceQuery),
      Event.countDocuments({ startTime: { $gte: startDate, $lte: endDate } }),
      User.countDocuments({ isActive: true }),
      Notification.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } })
    ]);

    return {
      totalAttendance,
      totalEvents,
      totalMembers,
      totalNotifications
    };
  }

  async getRecentActivity(filters, limit) {
    // Get recent audit logs or activities
    const query = {};
    if (filters.scopedAccess && filters.userRole !== USER_ROLES.SUPER_ADMIN) {
      query.userId = filters.userId;
    }

    return await AuditLog.find(query)
      .populate('userId', 'fullName role')
      .sort('-createdAt')
      .limit(limit);
  }

  async getQuickStats(filters, startDate, endDate) {
    // Get quick statistics for dashboard
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayAttendance, thisWeekEvents, activeMembers] = await Promise.all([
      Attendance.countDocuments({ markedAt: { $gte: today } }),
      Event.countDocuments({ 
        startTime: { $gte: today, $lte: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) },
        status: { $in: [EVENT_STATUS.UPCOMING, EVENT_STATUS.ACTIVE] }
      }),
      User.countDocuments({ isActive: true })
    ]);

    return {
      todayAttendance,
      thisWeekEvents,
      activeMembers
    };
  }

  async getSystemAlerts(filters, startDate, endDate) {
    // Generate alerts based on data analysis
    const alerts = [];

    // Low attendance events
    const lowAttendanceEvents = await this.getLowAttendanceEvents(startDate, endDate);
    if (lowAttendanceEvents.length > 0) {
      alerts.push({
        type: 'warning',
        title: 'Low Attendance Events',
        message: `${lowAttendanceEvents.length} events have attendance below 50%`,
        data: lowAttendanceEvents
      });
    }

    // Failed notifications
    const failedNotifications = await Notification.countDocuments({
      status: 'failed',
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    if (failedNotifications > 0) {
      alerts.push({
        type: 'error',
        title: 'Failed Notifications',
        message: `${failedNotifications} notifications failed to send`,
        count: failedNotifications
      });
    }

    return alerts;
  }

  async getLowAttendanceEvents(startDate, endDate) {
    return await Event.aggregate([
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate },
          status: EVENT_STATUS.COMPLETED
        }
      },
      {
        $lookup: {
          from: 'attendances',
          localField: '_id',
          foreignField: 'eventId',
          as: 'attendance'
        }
      },
      {
        $addFields: {
          totalAttendance: { $size: '$attendance' },
          presentCount: {
            $size: {
              $filter: {
                input: '$attendance',
                cond: { $eq: ['$$this.status', ATTENDANCE_STATUS.PRESENT] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          attendanceRate: {
            $cond: [
              { $gt: ['$totalAttendance', 0] },
              { $multiply: [{ $divide: ['$presentCount', '$totalAttendance'] }, 100] },
              0
            ]
          }
        }
      },
      {
        $match: { attendanceRate: { $lt: 50 } }
      },
      {
        $project: {
          title: 1,
          startTime: 1,
          attendanceRate: 1,
          totalAttendance: 1,
          presentCount: 1
        }
      }
    ]);
  }

  async getTrendingData(filters, startDate, endDate) {
    // Get trending metrics
    const attendanceTrend = await this.getAttendanceTrends(
      { markedAt: { $gte: startDate, $lte: endDate } },
      'week',
      startDate,
      endDate
    );

    return {
      attendance: attendanceTrend
    };
  }

  /**
   * Get member growth analytics
   */
  async getMemberGrowthAnalytics(memberQuery, startDate, endDate) {
    // Member growth over time
    const memberGrowth = await User.aggregate([
      {
        $match: {
          ...memberQuery,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            week: { $week: '$createdAt' }
          },
          newMembers: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1 } }
    ]);

    // Calculate growth rates
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [newMembers30Days, newMembers60Days, totalMembers] = await Promise.all([
      User.countDocuments({ ...memberQuery, createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ ...memberQuery, createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      User.countDocuments(memberQuery)
    ]);

    // Calculate growth rate
    const growthRate = newMembers60Days > 0 
      ? ((newMembers30Days - newMembers60Days) / newMembers60Days * 100)
      : (newMembers30Days > 0 ? 100 : 0);

    return {
      newMembers30Days,
      newMembers60Days,
      totalMembers,
      growthRate: parseFloat(growthRate.toFixed(2)),
      monthlyGrowth: memberGrowth,
      summary: {
        trend: growthRate > 0 ? 'increasing' : growthRate < 0 ? 'decreasing' : 'stable',
        percentageChange: Math.abs(growthRate)
      }
    };
  }

  /**
   * Get detailed attendance records
   */
  async getDetailedAttendanceRecords(matchConditions, options = {}) {
    const { limit = 1000, page = 1, includeUserDetails = true, includeEventDetails = true } = options;
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: matchConditions },
      { $sort: { markedAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    ];

    // Add user details if requested
    if (includeUserDetails) {
      pipeline.push(
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
      );
    }

    // Add event details if requested
    if (includeEventDetails) {
      pipeline.push(
        {
          $lookup: {
            from: 'events',
            localField: 'eventId',
            foreignField: '_id',
            as: 'event'
          }
        },
        { $unwind: { path: '$event', preserveNullAndEmptyArrays: true } }
      );
    }

    // Project necessary fields
    pipeline.push({
      $project: {
        _id: 1,
        status: 1,
        markedAt: 1,
        notes: 1,
        location: 1,
        ...(includeUserDetails && {
          'user._id': 1,
          'user.fullName': 1,
          'user.email': 1,
          'user.role': 1,
          'user.departmentId': 1
        }),
        ...(includeEventDetails && {
          'event._id': 1,
          'event.title': 1,
          'event.eventType': 1,
          'event.startTime': 1,
          'event.endTime': 1,
          'event.departmentId': 1
        })
      }
    });

    const [records, totalCount] = await Promise.all([
      Attendance.aggregate(pipeline),
      Attendance.countDocuments(matchConditions)
    ]);

         return {
       records,
       pagination: {
         total: totalCount,
         page,
         limit,
         pages: Math.ceil(totalCount / limit),
         hasNext: page * limit < totalCount,
         hasPrev: page > 1
       }
     };
   }

  /**
   * Get member engagement analytics
   */
  async getMemberEngagementAnalytics(memberQuery, startDate, endDate) {
    const engagementData = await User.aggregate([
      { $match: memberQuery },
      {
        $lookup: {
          from: 'attendances',
          localField: '_id',
          foreignField: 'userId',
          as: 'attendances'
        }
      },
      {
        $addFields: {
          totalAttendance: { $size: '$attendances' },
          recentAttendance: {
            $size: {
              $filter: {
                input: '$attendances',
                cond: { 
                  $and: [
                    { $gte: ['$$this.markedAt', startDate] },
                    { $lte: ['$$this.markedAt', endDate] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          highlyEngaged: { $sum: { $cond: [{ $gte: ['$recentAttendance', 8] }, 1, 0] } },
          moderatelyEngaged: { $sum: { $cond: [{ $and: [{ $gte: ['$recentAttendance', 4] }, { $lt: ['$recentAttendance', 8] }] }, 1, 0] } },
          lowEngaged: { $sum: { $cond: [{ $and: [{ $gt: ['$recentAttendance', 0] }, { $lt: ['$recentAttendance', 4] }] }, 1, 0] } },
          notEngaged: { $sum: { $cond: [{ $eq: ['$recentAttendance', 0] }, 1, 0] } },
          avgAttendance: { $avg: '$recentAttendance' }
        }
      }
    ]);

    const result = engagementData[0] || { highlyEngaged: 0, moderatelyEngaged: 0, lowEngaged: 0, notEngaged: 0, avgAttendance: 0 };
    
    return {
      categories: {
        highly: result.highlyEngaged,
        moderate: result.moderatelyEngaged,
        low: result.lowEngaged,
        none: result.notEngaged
      },
      averageAttendance: parseFloat((result.avgAttendance || 0).toFixed(2)),
      totalMembers: result.highlyEngaged + result.moderatelyEngaged + result.lowEngaged + result.notEngaged
    };
  }

  /**
   * Get role distribution analytics
   */
  async getRoleDistributionAnalytics(memberQuery) {
    return await User.aggregate([
      { $match: memberQuery },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
  }

  /**
   * Get department distribution analytics
   */
  async getDepartmentDistributionAnalytics(memberQuery) {
    return await User.aggregate([
      { $match: memberQuery },
      {
        $lookup: {
          from: 'departments',
          localField: 'departmentId',
          foreignField: '_id',
          as: 'department'
        }
      },
      { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            departmentId: '$department._id',
            departmentName: '$department.name'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
  }

  /**
   * Get member attendance behavior analysis
   */
  async getMemberAttendanceBehavior(memberQuery, startDate, endDate) {
    const behaviorData = await User.aggregate([
      { $match: memberQuery },
      {
        $lookup: {
          from: 'attendances',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$userId', '$$userId'] },
                markedAt: { $gte: startDate, $lte: endDate }
              }
            }
          ],
          as: 'attendances'
        }
      },
      {
        $addFields: {
          attendanceCount: { $size: '$attendances' },
          presentCount: {
            $size: {
              $filter: {
                input: '$attendances',
                cond: { $eq: ['$$this.status', ATTENDANCE_STATUS.PRESENT] }
              }
            }
          },
          lateCount: {
            $size: {
              $filter: {
                input: '$attendances',
                cond: { $eq: ['$$this.status', ATTENDANCE_STATUS.LATE] }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          regularAttendees: { $sum: { $cond: [{ $gte: ['$attendanceCount', 8] }, 1, 0] } },
          occasionalAttendees: { $sum: { $cond: [{ $and: [{ $gte: ['$attendanceCount', 3] }, { $lt: ['$attendanceCount', 8] }] }, 1, 0] } },
          rareAttendees: { $sum: { $cond: [{ $and: [{ $gt: ['$attendanceCount', 0] }, { $lt: ['$attendanceCount', 3] }] }, 1, 0] } },
          nonAttendees: { $sum: { $cond: [{ $eq: ['$attendanceCount', 0] }, 1, 0] } },
          avgAttendancePerMember: { $avg: '$attendanceCount' },
          punctualityRate: {
            $avg: {
              $cond: [
                { $gt: [{ $add: ['$presentCount', '$lateCount'] }, 0] },
                { $multiply: [{ $divide: ['$presentCount', { $add: ['$presentCount', '$lateCount'] }] }, 100] },
                0
              ]
            }
          }
        }
      }
    ]);

    const result = behaviorData[0] || {};
    
    return {
      patterns: {
        regular: result.regularAttendees || 0,
        occasional: result.occasionalAttendees || 0,
        rare: result.rareAttendees || 0,
        none: result.nonAttendees || 0
      },
      averageAttendancePerMember: parseFloat((result.avgAttendancePerMember || 0).toFixed(2)),
      punctualityRate: parseFloat((result.punctualityRate || 0).toFixed(2))
    };
  }

  /**
   * Get event attendance analytics
   */
  async getEventAttendanceAnalytics(eventQuery, startDate, endDate) {
    const attendanceData = await Event.aggregate([
      { $match: eventQuery },
      {
        $lookup: {
          from: 'attendances',
          localField: '_id',
          foreignField: 'eventId',
          as: 'attendances'
        }
      },
      {
        $addFields: {
          totalAttendance: { $size: '$attendances' },
          presentCount: {
            $size: {
              $filter: {
                input: '$attendances',
                cond: { $eq: ['$$this.status', ATTENDANCE_STATUS.PRESENT] }
              }
            }
          },
          lateCount: {
            $size: {
              $filter: {
                input: '$attendances',
                cond: { $eq: ['$$this.status', ATTENDANCE_STATUS.LATE] }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          avgAttendancePerEvent: { $avg: '$totalAttendance' },
          avgAttendanceRate: {
            $avg: {
              $cond: [
                { $gt: ['$totalAttendance', 0] },
                { $multiply: [{ $divide: [{ $add: ['$presentCount', '$lateCount'] }, '$totalAttendance'] }, 100] },
                0
              ]
            }
          },
          highAttendanceEvents: { 
            $sum: { 
              $cond: [
                { 
                  $gt: [
                    { 
                      $cond: [
                        { $gt: ['$totalAttendance', 0] },
                        { $multiply: [{ $divide: [{ $add: ['$presentCount', '$lateCount'] }, '$totalAttendance'] }, 100] },
                        0
                      ]
                    }, 
                    80
                  ] 
                }, 
                1, 
                0
              ] 
            }
          }
        }
      }
    ]);

    const result = attendanceData[0] || {};
    
    return {
      totalEvents: result.totalEvents || 0,
      averageAttendancePerEvent: parseFloat((result.avgAttendancePerEvent || 0).toFixed(2)),
      averageAttendanceRate: parseFloat((result.avgAttendanceRate || 0).toFixed(2)),
      highPerformingEvents: result.highAttendanceEvents || 0
    };
  }

  /**
   * Get event performance metrics
   */
  async getEventPerformanceMetrics(eventQuery) {
    return await Event.aggregate([
      { $match: eventQuery },
      {
        $group: {
          _id: '$eventType',
          totalEvents: { $sum: 1 },
          completedEvents: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.COMPLETED] }, 1, 0] } },
          cancelledEvents: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.CANCELLED] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          completionRate: {
            $cond: [
              { $gt: ['$totalEvents', 0] },
              { $multiply: [{ $divide: ['$completedEvents', '$totalEvents'] }, 100] },
              0
            ]
          }
        }
      },
      { $sort: { totalEvents: -1 } }
    ]);
  }

  /**
   * Get popular events
   */
  async getPopularEvents(eventQuery, limit = 10) {
    return await Event.aggregate([
      { $match: eventQuery },
      {
        $lookup: {
          from: 'attendances',
          localField: '_id',
          foreignField: 'eventId',
          as: 'attendances'
        }
      },
      {
        $addFields: {
          attendanceCount: { $size: '$attendances' }
        }
      },
      { $sort: { attendanceCount: -1 } },
      { $limit: limit },
      {
        $project: {
          title: 1,
          eventType: 1,
          startTime: 1,
          attendanceCount: 1,
          departmentId: 1
        }
      }
    ]);
  }

  /**
   * Get event creation trends
   */
  async getEventCreationTrends(eventQuery, startDate, endDate) {
    return await Event.aggregate([
      { $match: { ...eventQuery, createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            week: { $week: '$createdAt' }
          },
          eventsCreated: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1 } }
    ]);
  }

  /**
   * Get upcoming events summary
   */
  async getUpcomingEventsSummary(filters) {
    const query = {
      startTime: { $gte: new Date() },
      status: { $in: [EVENT_STATUS.UPCOMING, EVENT_STATUS.ACTIVE] }
    };

    // Apply scoped access
    if (filters.scopedAccess) {
      const scopedQuery = await this.applyScopedAccess(filters.userId, filters.userRole);
      if (scopedQuery.eventId) {
        query._id = scopedQuery.eventId;
      }
    }

    return await Event.find(query)
      .sort({ startTime: 1 })
      .limit(20)
      .select('title eventType startTime endTime departmentId status')
      .populate('departmentId', 'name');
  }
}

module.exports = new ReportService(); 
// Analytics Service
// Handles data analytics and reporting

const User = require('../models/User.model');
const Event = require('../models/Event.model');
const Attendance = require('../models/Attendance.model');
const Department = require('../models/Department.model');
const AuditLog = require('../models/AuditLog.model');
const Notification = require('../models/Notification.model');
const cacheService = require('./cache.service');
const logger = require('../utils/logger');
const { USER_ROLES, EVENT_STATUS, ATTENDANCE_STATUS } = require('../utils/constants');

class AnalyticsService {
  constructor() {
    this.cacheTimeout = 3600; // 1 hour
    this.trendCacheTimeout = 1800; // 30 minutes
  }

  /**
   * Get comprehensive dashboard analytics
   * @param {Object} options - Analytics options
   * @returns {Promise<Object>} Dashboard analytics
   */
  async getDashboardAnalytics(options = {}) {
    try {
      const { timeframe = 'month', userId, userRole } = options;
      const cacheKey = `dashboard:${timeframe}:${userId || 'global'}:${userRole || 'all'}`;
      
      return await cacheService.getOrSet(cacheKey, async () => {
        const dateRange = this.getDateRange(timeframe);
        
        const analytics = await Promise.all([
          this.getUserAnalytics(dateRange),
          this.getEventAnalytics(dateRange),
          this.getAttendanceAnalytics(dateRange),
          this.getDepartmentAnalytics(dateRange),
          this.getEngagementAnalytics(dateRange),
          this.getSystemHealthAnalytics()
        ]);

        return {
          timeframe,
          dateRange,
          users: analytics[0],
          events: analytics[1],
          attendance: analytics[2],
          departments: analytics[3],
          engagement: analytics[4],
          systemHealth: analytics[5],
          lastUpdated: new Date()
        };
      }, { ttl: this.cacheTimeout });

    } catch (error) {
      logger.error('Dashboard analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get user analytics
   * @param {Object} dateRange - Date range for analysis
   * @returns {Promise<Object>} User analytics
   */
  async getUserAnalytics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // Total active users
      const totalUsers = await User.countDocuments({ isActive: true });

      // New registrations in period
      const newUsers = await User.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Users by role
      const usersByRole = await User.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      // Users by department
      const usersByDepartment = await User.aggregate([
        { 
          $match: { 
            isActive: true,
            departments: { $exists: true, $not: { $size: 0 } }
          }
        },
        { $unwind: '$departments' },
        {
          $lookup: {
            from: 'departments',
            localField: 'departments',
            foreignField: '_id',
            as: 'deptInfo'
          }
        },
        { $unwind: '$deptInfo' },
        {
          $group: {
            _id: '$deptInfo.name',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Active users (logged in within period)
      const activeUsers = await User.countDocuments({
        lastLoginAt: { $gte: startDate, $lte: endDate }
      });

      // User growth trend (last 12 months)
      const userGrowthTrend = await this.getUserGrowthTrend();

      // Most active users
      const mostActiveUsers = await this.getMostActiveUsers(dateRange);

      return {
        total: totalUsers,
        new: newUsers,
        active: activeUsers,
        byRole: usersByRole,
        byDepartment: usersByDepartment,
        growthTrend: userGrowthTrend,
        mostActive: mostActiveUsers,
        activeRate: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(2) : 0
      };

    } catch (error) {
      logger.error('User analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get event analytics
   * @param {Object} dateRange - Date range for analysis
   * @returns {Promise<Object>} Event analytics
   */
  async getEventAnalytics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // Total events in period
      const totalEvents = await Event.countDocuments({
        startTime: { $gte: startDate, $lte: endDate }
      });

      // Events by status
      const eventsByStatus = await Event.aggregate([
        { $match: { startTime: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);

      // Events by type
      const eventsByType = await Event.aggregate([
        { $match: { startTime: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      // Average attendance per event
      const avgAttendancePerEvent = await Event.aggregate([
        { $match: { startTime: { $gte: startDate, $lte: endDate } } },
        {
          $lookup: {
            from: 'attendances',
            localField: '_id',
            foreignField: 'event',
            as: 'attendances'
          }
        },
        {
          $project: {
            attendanceCount: {
              $size: {
                $filter: {
                  input: '$attendances',
                  cond: { $in: ['$$this.status', [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE]] }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            avgAttendance: { $avg: '$attendanceCount' }
          }
        }
      ]);

      // Most popular events
      const popularEvents = await Event.aggregate([
        { $match: { startTime: { $gte: startDate, $lte: endDate } } },
        {
          $lookup: {
            from: 'attendances',
            localField: '_id',
            foreignField: 'event',
            as: 'attendances'
          }
        },
        {
          $project: {
            title: 1,
            type: 1,
            startTime: 1,
            attendanceCount: {
              $size: {
                $filter: {
                  input: '$attendances',
                  cond: { $in: ['$$this.status', [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE]] }
                }
              }
            }
          }
        },
        { $sort: { attendanceCount: -1 } },
        { $limit: 10 }
      ]);

      // Event creation trend
      const eventCreationTrend = await this.getEventCreationTrend(dateRange);

      return {
        total: totalEvents,
        byStatus: eventsByStatus,
        byType: eventsByType,
        avgAttendance: avgAttendancePerEvent[0]?.avgAttendance || 0,
        popular: popularEvents,
        creationTrend: eventCreationTrend
      };

    } catch (error) {
      logger.error('Event analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get attendance analytics
   * @param {Object} dateRange - Date range for analysis
   * @returns {Promise<Object>} Attendance analytics
   */
  async getAttendanceAnalytics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // Total attendance records
      const totalAttendance = await Attendance.countDocuments({
        markedAt: { $gte: startDate, $lte: endDate }
      });

      // Attendance by status
      const attendanceByStatus = await Attendance.aggregate([
        { $match: { markedAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);

      // Attendance rate
      const attendanceRate = await this.calculateAttendanceRate(dateRange);

      // Late attendance analysis
      const lateAttendanceAnalysis = await Attendance.aggregate([
        { 
          $match: { 
            markedAt: { $gte: startDate, $lte: endDate },
            status: ATTENDANCE_STATUS.LATE
          }
        },
        {
          $lookup: {
            from: 'events',
            localField: 'event',
            foreignField: '_id',
            as: 'eventInfo'
          }
        },
        { $unwind: '$eventInfo' },
        {
          $project: {
            lateDuration: {
              $divide: [
                { $subtract: ['$markedAt', '$eventInfo.startTime'] },
                60000 // Convert to minutes
              ]
            },
            eventType: '$eventInfo.type'
          }
        },
        {
          $group: {
            _id: '$eventType',
            avgLateDuration: { $avg: '$lateDuration' },
            count: { $sum: 1 }
          }
        }
      ]);

      // Attendance trends
      const attendanceTrend = await this.getAttendanceTrend(dateRange);

      // Top attendees
      const topAttendees = await this.getTopAttendees(dateRange);

      return {
        total: totalAttendance,
        byStatus: attendanceByStatus,
        rate: attendanceRate,
        lateAnalysis: lateAttendanceAnalysis,
        trend: attendanceTrend,
        topAttendees: topAttendees
      };

    } catch (error) {
      logger.error('Attendance analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get department analytics
   * @param {Object} dateRange - Date range for analysis
   * @returns {Promise<Object>} Department analytics
   */
  async getDepartmentAnalytics(dateRange) {
    try {
      // Total departments
      const totalDepartments = await Department.countDocuments({ isActive: true });

      // Department member distribution
      const departmentMembers = await User.aggregate([
        { $match: { isActive: true, departments: { $exists: true, $not: { $size: 0 } } } },
        { $unwind: '$departments' },
        {
          $lookup: {
            from: 'departments',
            localField: 'departments',
            foreignField: '_id',
            as: 'deptInfo'
          }
        },
        { $unwind: '$deptInfo' },
        {
          $group: {
            _id: {
              id: '$deptInfo._id',
              name: '$deptInfo.name',
              code: '$deptInfo.code'
            },
            memberCount: { $sum: 1 }
          }
        },
        { $sort: { memberCount: -1 } }
      ]);

      // Department event activity
      const departmentEventActivity = await Event.aggregate([
        { 
          $match: { 
            createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            targetDepartments: { $exists: true, $not: { $size: 0 } }
          }
        },
        { $unwind: '$targetDepartments' },
        {
          $lookup: {
            from: 'departments',
            localField: 'targetDepartments',
            foreignField: '_id',
            as: 'deptInfo'
          }
        },
        { $unwind: '$deptInfo' },
        {
          $group: {
            _id: {
              id: '$deptInfo._id',
              name: '$deptInfo.name'
            },
            eventCount: { $sum: 1 }
          }
        },
        { $sort: { eventCount: -1 } }
      ]);

      return {
        total: totalDepartments,
        memberDistribution: departmentMembers,
        eventActivity: departmentEventActivity
      };

    } catch (error) {
      logger.error('Department analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get engagement analytics
   * @param {Object} dateRange - Date range for analysis
   * @returns {Promise<Object>} Engagement analytics
   */
  async getEngagementAnalytics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // User login frequency
      const loginFrequency = await AuditLog.aggregate([
        {
          $match: {
            action: 'login',
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$userId',
            loginCount: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: null,
            avgLogins: { $avg: '$loginCount' },
            totalLogins: { $sum: '$loginCount' },
            uniqueUsers: { $sum: 1 }
          }
        }
      ]);

      // Feature usage analytics
      const featureUsage = await AuditLog.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Notification engagement
      const notificationEngagement = await Notification.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      return {
        loginStats: loginFrequency[0] || { avgLogins: 0, totalLogins: 0, uniqueUsers: 0 },
        featureUsage: featureUsage,
        notificationEngagement: notificationEngagement
      };

    } catch (error) {
      logger.error('Engagement analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get system health analytics
   * @returns {Promise<Object>} System health analytics
   */
  async getSystemHealthAnalytics() {
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Error rate analysis
      const errorRate = await AuditLog.aggregate([
        {
          $match: {
            createdAt: { $gte: last24Hours },
            level: { $in: ['error', 'warn'] }
          }
        },
        {
          $group: {
            _id: '$level',
            count: { $sum: 1 }
          }
        }
      ]);

      // Database performance metrics
      const dbStats = {
        totalUsers: await User.countDocuments(),
        totalEvents: await Event.countDocuments(),
        totalAttendance: await Attendance.countDocuments(),
        totalDepartments: await Department.countDocuments()
      };

      // Cache performance (if available)
      const cacheStats = await cacheService.getStats();

      return {
        errorRate: errorRate,
        databaseStats: dbStats,
        cacheStats: cacheStats,
        lastChecked: now
      };

    } catch (error) {
      logger.error('System health analytics failed:', error);
      return {
        error: error.message,
        lastChecked: new Date()
      };
    }
  }

  /**
   * Get predictive analytics
   * @param {Object} options - Prediction options
   * @returns {Promise<Object>} Predictive analytics
   */
  async getPredictiveAnalytics(options = {}) {
    try {
      const { type = 'attendance', lookAhead = 30 } = options;
      const cacheKey = `predictive:${type}:${lookAhead}`;

      return await cacheService.getOrSet(cacheKey, async () => {
        let predictions = {};

        switch (type) {
          case 'attendance':
            predictions = await this.predictAttendance(lookAhead);
            break;
          case 'events':
            predictions = await this.predictEventTrends(lookAhead);
            break;
          case 'growth':
            predictions = await this.predictUserGrowth(lookAhead);
            break;
          default:
            throw new Error(`Unsupported prediction type: ${type}`);
        }

        return {
          type,
          lookAhead,
          predictions,
          generatedAt: new Date(),
          confidence: predictions.confidence || 'medium'
        };
      }, { ttl: this.trendCacheTimeout });

    } catch (error) {
      logger.error('Predictive analytics failed:', error);
      throw error;
    }
  }

  /**
   * Get real-time metrics
   * @returns {Promise<Object>} Real-time metrics
   */
  async getRealTimeMetrics() {
    try {
      const now = new Date();
      const last5Minutes = new Date(now.getTime() - 5 * 60 * 1000);
      const last1Hour = new Date(now.getTime() - 60 * 60 * 1000);

      // Recent activity
      const recentActivity = await AuditLog.aggregate([
        { $match: { createdAt: { $gte: last5Minutes } } },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      // Active events
      const activeEvents = await Event.countDocuments({
        status: EVENT_STATUS.ACTIVE,
        startTime: { $lte: now },
        $or: [
          { endTime: { $gte: now } },
          { endTime: { $exists: false } }
        ]
      });

      // Current online users (based on recent activity)
      const onlineUsers = await AuditLog.distinct('userId', {
        createdAt: { $gte: last1Hour }
      }).then(userIds => userIds.length);

      // Recent registrations
      const recentRegistrations = await User.countDocuments({
        createdAt: { $gte: last1Hour }
      });

      return {
        timestamp: now,
        recentActivity: recentActivity,
        activeEvents: activeEvents,
        onlineUsers: onlineUsers,
        recentRegistrations: recentRegistrations
      };

    } catch (error) {
      logger.error('Real-time metrics failed:', error);
      throw error;
    }
  }

  // Helper methods for complex calculations

  /**
   * Get date range based on timeframe
   */
  getDateRange(timeframe) {
    const now = new Date();
    let startDate;

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate: now };
  }

  /**
   * Get user growth trend
   */
  async getUserGrowthTrend() {
    const months = [];
    const now = new Date();
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      
      const count = await User.countDocuments({
        createdAt: { $gte: date, $lt: nextMonth }
      });
      
      months.push({
        month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count: count
      });
    }
    
    return months;
  }

  /**
   * Calculate attendance rate
   */
  async calculateAttendanceRate(dateRange) {
    const { startDate, endDate } = dateRange;
    
    const totalExpected = await Attendance.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const totalPresent = await Attendance.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE] }
    });
    
    return totalExpected > 0 ? ((totalPresent / totalExpected) * 100).toFixed(2) : 0;
  }

  /**
   * Predict attendance trends
   */
  async predictAttendance(days) {
    // Simple linear regression based on historical data
    const historicalData = await Attendance.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$markedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } },
      { $limit: 30 } // Last 30 days
    ]);

    if (historicalData.length < 7) {
      return { trend: 'insufficient_data', confidence: 'low' };
    }

    // Calculate simple trend
    const counts = historicalData.map(d => d.count);
    const avgGrowth = counts.length > 1 
      ? (counts[counts.length - 1] - counts[0]) / counts.length
      : 0;

    const predictions = [];
    const lastCount = counts[counts.length - 1] || 0;

    for (let i = 1; i <= days; i++) {
      const predicted = Math.max(0, Math.round(lastCount + (avgGrowth * i)));
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      predictions.push({
        date: date.toISOString().split('T')[0],
        predicted: predicted
      });
    }

    return {
      trend: avgGrowth > 0 ? 'increasing' : avgGrowth < 0 ? 'decreasing' : 'stable',
      predictions: predictions,
      confidence: historicalData.length >= 20 ? 'high' : 'medium'
    };
  }

  /**
   * Export analytics to different formats
   */
  async exportAnalytics(type, format, options = {}) {
    try {
      let data;
      
      switch (type) {
        case 'dashboard':
          data = await this.getDashboardAnalytics(options);
          break;
        case 'users':
          data = await this.getUserAnalytics(this.getDateRange(options.timeframe || 'month'));
          break;
        case 'events':
          data = await this.getEventAnalytics(this.getDateRange(options.timeframe || 'month'));
          break;
        default:
          throw new Error(`Unsupported analytics type: ${type}`);
      }

      return {
        type,
        format,
        data,
        exportedAt: new Date(),
        options
      };

    } catch (error) {
      logger.error('Analytics export failed:', error);
      throw error;
    }
  }
}

module.exports = new AnalyticsService(); 
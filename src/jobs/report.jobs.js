// Report Jobs
// Handles scheduled reports, export processing, analytics update, and archiving

const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const User = require('../models/User.model');
const Event = require('../models/Event.model');
const Attendance = require('../models/Attendance.model');
const Department = require('../models/Department.model');
const AuditLog = require('../models/AuditLog.model');
const reportService = require('../services/report.service');
const notificationService = require('../services/notification.service');
const redisConfig = require('../config/redis');
const logger = require('../utils/logger');
const { ATTENDANCE_STATUS, EVENT_STATUS, USER_ROLES } = require('../utils/constants');

class ReportJobs {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
    this.reportsDir = path.join(__dirname, '../../../reports');
  }

  /**
   * Generate scheduled reports
   * Runs daily at 6 AM for daily reports, weekly on Monday, monthly on 1st
   */
  async generateScheduledReports() {
    try {
      logger.info('Starting scheduled reports generation');
      
      const now = new Date();
      const reportStats = {
        dailyReports: 0,
        weeklyReports: 0,
        monthlyReports: 0,
        emailsSent: 0
      };

      // Ensure reports directory exists
      await this.ensureReportsDirectory();

      // Generate daily reports
      await this.generateDailyReports(now, reportStats);

      // Generate weekly reports (on Mondays)
      if (now.getDay() === 1) {
        await this.generateWeeklyReports(now, reportStats);
      }

      // Generate monthly reports (on 1st of month)
      if (now.getDate() === 1) {
        await this.generateMonthlyReports(now, reportStats);
      }

      logger.info('Scheduled reports generation completed:', reportStats);
      return { success: true, stats: reportStats };
      
    } catch (error) {
      logger.error('Scheduled reports generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate daily reports
   */
  async generateDailyReports(date, stats) {
    try {
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const dayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      // Daily attendance summary
      const dailyAttendance = await this.generateDailyAttendanceReport(dayStart, dayEnd);
      if (dailyAttendance) {
        stats.dailyReports++;
      }

      // Daily events summary
      const dailyEvents = await this.generateDailyEventsReport(dayStart, dayEnd);
      if (dailyEvents) {
        stats.dailyReports++;
      }

      // Send daily summary to senior pastors
      const seniorPastors = await User.find({
        role: { $in: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SENIOR_PASTOR] },
        isActive: true,
        receiveReports: true
      });

      for (const pastor of seniorPastors) {
        if (pastor.phone) {
          try {
            await notificationService.sendDailyReport(
              pastor.phone,
              dailyAttendance,
              dailyEvents,
              yesterday.toDateString()
            );
            stats.emailsSent++;
          } catch (notifyError) {
            logger.error(`Failed to send daily report to ${pastor.phone}:`, notifyError);
          }
        }
      }
      
    } catch (error) {
      logger.error('Daily reports generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate weekly reports
   */
  async generateWeeklyReports(date, stats) {
    try {
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - 7);
      const weekEnd = new Date(date);

      // Weekly attendance trends
      const weeklyAttendance = await this.generateWeeklyAttendanceReport(weekStart, weekEnd);
      if (weeklyAttendance) {
        stats.weeklyReports++;
      }

      // Weekly department performance
      const departmentPerformance = await this.generateDepartmentPerformanceReport(weekStart, weekEnd);
      if (departmentPerformance) {
        stats.weeklyReports++;
      }

      // Weekly user engagement
      const userEngagement = await this.generateUserEngagementReport(weekStart, weekEnd);
      if (userEngagement) {
        stats.weeklyReports++;
      }
      
    } catch (error) {
      logger.error('Weekly reports generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate monthly reports
   */
  async generateMonthlyReports(date, stats) {
    try {
      const monthStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth(), 0);

      // Monthly comprehensive report
      const monthlyReport = await this.generateMonthlyComprehensiveReport(monthStart, monthEnd);
      if (monthlyReport) {
        stats.monthlyReports++;
      }

      // Monthly trends analysis
      const trendsReport = await this.generateMonthlyTrendsReport(monthStart, monthEnd);
      if (trendsReport) {
        stats.monthlyReports++;
      }
      
    } catch (error) {
      logger.error('Monthly reports generation failed:', error);
      throw error;
    }
  }

  /**
   * Process export requests and generate files
   * Runs every 30 minutes
   */
  async processExports() {
    try {
      logger.info('Starting export processing job');
      
      const exportStats = {
        processed: 0,
        successful: 0,
        failed: 0,
        totalSize: 0
      };

      // Get pending export requests from Redis
      const exportQueue = await redisConfig.lrange('export:queue', 0, -1);
      
      for (const exportRequestStr of exportQueue) {
        try {
          const exportRequest = JSON.parse(exportRequestStr);
          exportStats.processed++;

          const result = await this.processExportRequest(exportRequest);
          
          if (result.success) {
            exportStats.successful++;
            exportStats.totalSize += result.fileSize || 0;

            // Remove from queue
            await redisConfig.lrem('export:queue', 1, exportRequestStr);

            // Notify user
            if (exportRequest.userPhone) {
              await notificationService.sendExportReady(
                exportRequest.userPhone,
                exportRequest.type,
                result.downloadUrl
              );
            }
          } else {
            exportStats.failed++;
            logger.error(`Export failed for request ${exportRequest.id}:`, result.error);
          }
          
        } catch (exportError) {
          exportStats.failed++;
          logger.error('Export processing error:', exportError);
        }
      }

      logger.info('Export processing job completed:', exportStats);
      return { success: true, stats: exportStats };
      
    } catch (error) {
      logger.error('Export processing job failed:', error);
      throw error;
    }
  }

  /**
   * Process individual export request
   */
  async processExportRequest(request) {
    try {
      const { type, filters, format, userId, userPhone } = request;
      
      let data;
      let filename;
      
      switch (type) {
        case 'attendance':
          data = await this.exportAttendanceData(filters);
          filename = `attendance_export_${Date.now()}.${format}`;
          break;
          
        case 'users':
          data = await this.exportUsersData(filters);
          filename = `users_export_${Date.now()}.${format}`;
          break;
          
        case 'events':
          data = await this.exportEventsData(filters);
          filename = `events_export_${Date.now()}.${format}`;
          break;
          
        case 'departments':
          data = await this.exportDepartmentsData(filters);
          filename = `departments_export_${Date.now()}.${format}`;
          break;
          
        default:
          throw new Error(`Unsupported export type: ${type}`);
      }

      // Generate file based on format
      const filePath = path.join(this.reportsDir, 'exports', filename);
      await this.ensureDirectory(path.dirname(filePath));
      
      let fileSize = 0;
      
      if (format === 'xlsx') {
        fileSize = await this.generateExcelFile(data, filePath);
      } else if (format === 'csv') {
        fileSize = await this.generateCSVFile(data, filePath);
      } else if (format === 'pdf') {
        fileSize = await this.generatePDFFile(data, filePath, type);
      }

      return {
        success: true,
        fileSize,
        downloadUrl: `/api/reports/download/${filename}`,
        filePath
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update analytics and cache computed metrics
   * Runs every 2 hours
   */
  async updateAnalytics() {
    try {
      logger.info('Starting analytics update job');
      
      const analyticsStats = {
        userMetrics: 0,
        eventMetrics: 0,
        departmentMetrics: 0,
        attendanceMetrics: 0
      };

      const now = new Date();
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Update user analytics
      const userAnalytics = await this.calculateUserAnalytics(last30Days, now);
      await redisConfig.setex('analytics:users', 7200, JSON.stringify(userAnalytics));
      analyticsStats.userMetrics = Object.keys(userAnalytics).length;

      // Update event analytics
      const eventAnalytics = await this.calculateEventAnalytics(last30Days, now);
      await redisConfig.setex('analytics:events', 7200, JSON.stringify(eventAnalytics));
      analyticsStats.eventMetrics = Object.keys(eventAnalytics).length;

      // Update department analytics
      const departmentAnalytics = await this.calculateDepartmentAnalytics(last30Days, now);
      await redisConfig.setex('analytics:departments', 7200, JSON.stringify(departmentAnalytics));
      analyticsStats.departmentMetrics = Object.keys(departmentAnalytics).length;

      // Update attendance analytics
      const attendanceAnalytics = await this.calculateAttendanceAnalytics(last30Days, now);
      await redisConfig.setex('analytics:attendance', 7200, JSON.stringify(attendanceAnalytics));
      analyticsStats.attendanceMetrics = Object.keys(attendanceAnalytics).length;

      // Update trending data
      const trendingData = await this.calculateTrendingMetrics(last7Days, now);
      await redisConfig.setex('analytics:trending', 3600, JSON.stringify(trendingData));

      logger.info('Analytics update job completed:', analyticsStats);
      return { success: true, stats: analyticsStats };
      
    } catch (error) {
      logger.error('Analytics update job failed:', error);
      throw error;
    }
  }

  /**
   * Archive old data to reduce database size
   * Runs monthly on the 2nd
   */
  async archiveOldData() {
    try {
      logger.info('Starting data archiving job');
      
      const archiveStats = {
        archivedAuditLogs: 0,
        archivedNotifications: 0,
        archivedEvents: 0,
        totalSizeReduced: 0
      };

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Archive old audit logs (keep only 6 months)
      const oldAuditLogs = await AuditLog.find({
        createdAt: { $lt: sixMonthsAgo }
      }).lean();

      if (oldAuditLogs.length > 0) {
        // Export to archive file
        const archiveFilePath = path.join(
          this.reportsDir, 
          'archives', 
          `audit_logs_${sixMonthsAgo.getFullYear()}_${sixMonthsAgo.getMonth() + 1}.json`
        );
        
        await this.ensureDirectory(path.dirname(archiveFilePath));
        await fs.writeFile(archiveFilePath, JSON.stringify(oldAuditLogs, null, 2));

        // Delete from database
        await AuditLog.deleteMany({
          createdAt: { $lt: sixMonthsAgo }
        });

        archiveStats.archivedAuditLogs = oldAuditLogs.length;
      }

      // Archive old notifications (keep only 3 months)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const oldNotifications = await Notification.countDocuments({
        createdAt: { $lt: threeMonthsAgo },
        status: { $in: ['delivered', 'failed'] }
      });

      if (oldNotifications > 0) {
        await Notification.deleteMany({
          createdAt: { $lt: threeMonthsAgo },
          status: { $in: ['delivered', 'failed'] }
        });
        archiveStats.archivedNotifications = oldNotifications;
      }

      // Archive completed events older than 1 year
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const veryOldEvents = await Event.find({
        createdAt: { $lt: oneYearAgo },
        status: EVENT_STATUS.COMPLETED
      }).populate('attendance').lean();

      if (veryOldEvents.length > 0) {
        // Archive events with their attendance
        const archiveFilePath = path.join(
          this.reportsDir,
          'archives',
          `events_${oneYearAgo.getFullYear()}.json`
        );

        await fs.writeFile(archiveFilePath, JSON.stringify(veryOldEvents, null, 2));
        
        // Delete attendance records for these events
        await Attendance.deleteMany({
          event: { $in: veryOldEvents.map(e => e._id) }
        });

        // Delete the events
        await Event.deleteMany({
          _id: { $in: veryOldEvents.map(e => e._id) }
        });

        archiveStats.archivedEvents = veryOldEvents.length;
      }

      logger.info('Data archiving job completed:', archiveStats);
      return { success: true, stats: archiveStats };
      
    } catch (error) {
      logger.error('Data archiving job failed:', error);
      throw error;
    }
  }

  // Helper methods for report generation

  /**
   * Generate daily attendance report
   */
  async generateDailyAttendanceReport(startDate, endDate) {
    const attendanceData = await Attendance.aggregate([
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'eventData'
        }
      },
      {
        $match: {
          'eventData.startTime': { $gte: startDate, $lt: endDate }
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
      date: startDate,
      attendance: attendanceData,
      totalEvents: await Event.countDocuments({
        startTime: { $gte: startDate, $lt: endDate }
      })
    };
  }

  /**
   * Calculate user analytics
   */
  async calculateUserAnalytics(startDate, endDate) {
    return {
      totalUsers: await User.countDocuments({ isActive: true }),
      newUsers: await User.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      usersByRole: await User.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      activeUsers: await User.countDocuments({
        lastLoginAt: { $gte: startDate }
      })
    };
  }

  /**
   * Generate Excel file
   */
  async generateExcelFile(data, filePath) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, filePath);
    
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Ensure reports directory exists
   */
  async ensureReportsDirectory() {
    await this.ensureDirectory(this.reportsDir);
    await this.ensureDirectory(path.join(this.reportsDir, 'daily'));
    await this.ensureDirectory(path.join(this.reportsDir, 'weekly'));
    await this.ensureDirectory(path.join(this.reportsDir, 'monthly'));
    await this.ensureDirectory(path.join(this.reportsDir, 'exports'));
    await this.ensureDirectory(path.join(this.reportsDir, 'archives'));
  }

  /**
   * Start all report jobs
   */
  startJobs() {
    if (this.isRunning) {
      logger.warn('Report jobs are already running');
      return;
    }

    // Scheduled reports daily at 6 AM
    const scheduledReportsJob = cron.schedule('0 6 * * *', async () => {
      await this.generateScheduledReports();
    }, { scheduled: false });

    // Export processing every 30 minutes
    const exportProcessingJob = cron.schedule('*/30 * * * *', async () => {
      await this.processExports();
    }, { scheduled: false });

    // Analytics update every 2 hours
    const analyticsUpdateJob = cron.schedule('0 */2 * * *', async () => {
      await this.updateAnalytics();
    }, { scheduled: false });

    // Data archiving monthly on the 2nd at 3 AM
    const archivingJob = cron.schedule('0 3 2 * *', async () => {
      await this.archiveOldData();
    }, { scheduled: false });

    // Store jobs for management
    this.jobs.set('scheduledReports', scheduledReportsJob);
    this.jobs.set('exportProcessing', exportProcessingJob);
    this.jobs.set('analyticsUpdate', analyticsUpdateJob);
    this.jobs.set('archiving', archivingJob);

    // Start all jobs
    scheduledReportsJob.start();
    exportProcessingJob.start();
    analyticsUpdateJob.start();
    archivingJob.start();

    // Run initial analytics update
    this.updateAnalytics().catch(error => {
      logger.error('Initial analytics update failed:', error);
    });

    this.isRunning = true;
    logger.info('Report jobs started successfully');
  }

  /**
   * Stop all report jobs
   */
  stopJobs() {
    if (!this.isRunning) {
      logger.warn('Report jobs are not running');
      return;
    }

    this.jobs.forEach((job, name) => {
      job.destroy();
      logger.info(`Stopped report job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    logger.info('All report jobs stopped');
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size
    };
  }
}

module.exports = new ReportJobs(); 
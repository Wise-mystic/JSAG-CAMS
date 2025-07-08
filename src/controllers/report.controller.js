// Report Controller
// Handles attendance summary, analytics, exports, dashboard data

const ReportService = require('../services/report.service');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');

class ReportController {
  // GET /api/v1/reports/attendance
  async getAttendanceSummary(req, res, next) {
    try {
      const {
        timeframe,
        departmentId,
        ministryId,
        eventType,
        includeDetails,
        groupBy
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: parseInt(timeframe) || 30,
        departmentId,
        ministryId,
        eventType,
        includeDetails: includeDetails === 'true',
        groupBy: groupBy || 'week'
      };

      const report = await ReportService.getAttendanceSummary(filters, options);

      logger.info('Attendance summary report generated', {
        userId: req.user.id,
        timeframe: options.timeframe,
        groupBy: options.groupBy,
        totalRecords: report.overview?.total || 0
      });

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Get attendance summary failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/reports/members
  async getMemberAnalytics(req, res, next) {
    try {
      const {
        timeframe,
        includeInactive,
        departmentId,
        ministryId,
        role
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: parseInt(timeframe) || 90,
        includeInactive: includeInactive === 'true',
        departmentId,
        ministryId,
        role
      };

      const report = await ReportService.getMemberAnalytics(filters, options);

      logger.info('Member analytics report generated', {
        userId: req.user.id,
        timeframe: options.timeframe,
        totalMembers: report.overview?.total || 0
      });

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Get member analytics failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/reports/departments
  async getDepartmentPerformance(req, res, next) {
    try {
      const {
        timeframe,
        includeSubDepartments,
        includeComparison
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: parseInt(timeframe) || 30,
        includeSubDepartments: includeSubDepartments !== 'false',
        includeComparison: includeComparison !== 'false'
      };

      const report = await ReportService.getDepartmentPerformance(filters, options);

      logger.info('Department performance report generated', {
        userId: req.user.id,
        timeframe: options.timeframe,
        departmentCount: report.departments?.length || 0
      });

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Get department performance failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/reports/events
  async getEventAnalytics(req, res, next) {
    try {
      const {
        timeframe,
        eventType,
        departmentId,
        includeUpcoming
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: parseInt(timeframe) || 60,
        eventType,
        departmentId,
        includeUpcoming: includeUpcoming !== 'false'
      };

      const report = await ReportService.getEventAnalytics(filters, options);

      logger.info('Event analytics report generated', {
        userId: req.user.id,
        timeframe: options.timeframe,
        totalEvents: report.overview?.total || 0
      });

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Get event analytics failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/reports/export
  async exportReport(req, res, next) {
    try {
      const { reportType, format = 'json', includeCharts = false } = req.body;
      const {
        timeframe,
        departmentId,
        ministryId,
        eventType,
        includeDetails
      } = req.body.options || {};

      if (!reportType) {
        return next(ApiError.badRequest('Report type is required'));
      }

      // Validate report type
      const validTypes = ['attendance', 'members', 'departments', 'events', 'comprehensive'];
      if (!validTypes.includes(reportType)) {
        return next(ApiError.badRequest(`Invalid report type. Must be one of: ${validTypes.join(', ')}`));
      }

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        format,
        includeCharts,
        timeframe: parseInt(timeframe) || 30,
        departmentId,
        ministryId,
        eventType,
        includeDetails: includeDetails === true
      };

      const exportData = await ReportService.exportReport(reportType, filters, options);

      logger.info('Report exported successfully', {
        reportType,
        format,
        userId: req.user.id,
        timeframe: options.timeframe
      });

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(exportData);
      } else {
        res.status(200).json({
          success: true,
          data: exportData
        });
      }
    } catch (error) {
      logger.error('Export report failed', {
        error: error.message,
        userId: req.user.id,
        reportType: req.body.reportType,
        format: req.body.format
      });
      next(error);
    }
  }

  // GET /api/v1/reports/dashboard
  async getDashboard(req, res, next) {
    try {
      const { timeframe } = req.query;

      const options = {
        timeframe: parseInt(timeframe) || 30
      };

      const dashboard = await ReportService.getDashboard(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error('Get dashboard failed', {
        error: error.message,
        userId: req.user.id,
        timeframe: req.query.timeframe
      });
      next(error);
    }
  }

  // GET /api/v1/reports/download/:exportId
  async downloadExport(req, res, next) {
    try {
      const { exportId } = req.params;

      // In a real implementation, you would:
      // 1. Store export files with unique IDs
      // 2. Implement proper file serving with security checks
      // 3. Handle different file formats
      // 4. Implement download tracking

      // For now, return a placeholder response
      res.status(200).json({
        success: true,
        message: 'Download functionality not yet implemented',
        exportId
      });
    } catch (error) {
      logger.error('Download export failed', {
        error: error.message,
        exportId: req.params.exportId,
        userId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/reports/summary
  async getComprehensiveSummary(req, res, next) {
    try {
      const { timeframe = 30 } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: parseInt(timeframe)
      };

      // Get a simplified version of all report types
      const [attendance, members, departments, events] = await Promise.all([
        ReportService.getAttendanceSummary(filters, { ...options, includeDetails: false }),
        ReportService.getMemberAnalytics(filters, options),
        ReportService.getDepartmentPerformance(filters, options),
        ReportService.getEventAnalytics(filters, options)
      ]);

      const summary = {
        period: attendance.period,
        attendance: {
          total: attendance.overview.total,
          attendanceRate: attendance.overview.attendanceRate,
          punctualityRate: attendance.overview.punctualityRate
        },
        members: {
          total: members.overview.total,
          newMembers: members.growth.newMembers30Days,
          distribution: members.distribution
        },
        departments: {
          total: departments.departments.length,
          topPerformer: departments.topPerformer,
          averageScore: departments.averages.avgPerformanceScore
        },
        events: {
          total: events.overview.total,
          completed: events.overview.completed,
          upcoming: events.upcoming.length
        },
        generatedAt: new Date()
      };

      logger.info('Comprehensive summary generated', {
        userId: req.user.id,
        timeframe: options.timeframe
      });

      res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      logger.error('Get comprehensive summary failed', {
        error: error.message,
        userId: req.user.id,
        timeframe: req.query.timeframe
      });
      next(error);
    }
  }

  // GET /api/v1/reports/trends
  async getTrends(req, res, next) {
    try {
      const { 
        metric = 'attendance', 
        timeframe = 90, 
        groupBy = 'week',
        departmentId 
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      let trendData;

      switch (metric) {
        case 'attendance':
          const attendanceReport = await ReportService.getAttendanceSummary(filters, {
            timeframe: parseInt(timeframe),
            groupBy,
            departmentId
          });
          trendData = attendanceReport.trends;
          break;

        case 'events':
          const eventReport = await ReportService.getEventAnalytics(filters, {
            timeframe: parseInt(timeframe),
            departmentId
          });
          trendData = eventReport.trends;
          break;

        default:
          return next(ApiError.badRequest('Invalid metric. Must be attendance or events'));
      }

      res.status(200).json({
        success: true,
        data: {
          metric,
          timeframe: parseInt(timeframe),
          groupBy,
          trends: trendData,
          generatedAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Get trends failed', {
        error: error.message,
        userId: req.user.id,
        metric: req.query.metric
      });
      next(error);
    }
  }

  // GET /api/v1/reports/compare
  async comparePerformance(req, res, next) {
    try {
      const { 
        type = 'departments', // departments, events, members
        period1Start,
        period1End,
        period2Start,
        period2End,
        metric = 'attendance'
      } = req.query;

      if (!period1Start || !period1End || !period2Start || !period2End) {
        return next(ApiError.badRequest('All period dates are required for comparison'));
      }

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      // This is a simplified comparison - in a full implementation, you'd have more sophisticated comparison logic
      const comparison = {
        type,
        metric,
        period1: { start: period1Start, end: period1End },
        period2: { start: period2Start, end: period2End },
        results: {
          message: 'Comparison functionality requires additional implementation based on specific business needs'
        },
        generatedAt: new Date()
      };

      logger.info('Performance comparison requested', {
        userId: req.user.id,
        type,
        metric
      });

      res.status(200).json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error('Compare performance failed', {
        error: error.message,
        userId: req.user.id,
        type: req.query.type
      });
      next(error);
    }
  }

  // GET /api/v1/reports/ministry-performance
  async getMinistryPerformance(req, res, next) {
    try {
      const { 
        startDate, 
        endDate, 
        ministryId,
        includeComparison = false 
      } = req.query;

      const filters = {
        scopedAccess: true,
        userId: req.user.id,
        userRole: req.user.role
      };

      const options = {
        timeframe: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)),
        ministryId,
        includeComparison: includeComparison === 'true'
      };

      // For now, return ministry performance as department performance
      // In a full implementation, you'd have a separate ministry model and analytics
      const departmentReport = await ReportService.getDepartmentPerformance(filters, options);

      const ministryPerformance = {
        period: { startDate, endDate },
        ministries: departmentReport.departments.map(dept => ({
          ministry: {
            id: dept.department.id,
            name: dept.department.name,
            category: dept.department.category,
            leaderId: dept.department.leaderId
          },
          memberCount: dept.memberCount,
          attendance: dept.attendance,
          events: dept.events,
          performanceScore: dept.performanceScore
        })),
        averages: departmentReport.averages,
        topPerformer: departmentReport.topPerformer,
        summary: {
          totalMinistries: departmentReport.departments.length,
          totalMembers: departmentReport.departments.reduce((sum, dept) => sum + dept.memberCount, 0),
          avgPerformanceScore: departmentReport.averages.avgPerformanceScore
        },
        generatedAt: new Date()
      };

      logger.info('Ministry performance report generated', {
        userId: req.user.id,
        timeframe: options.timeframe,
        totalMinistries: ministryPerformance.summary.totalMinistries
      });

      res.status(200).json({
        success: true,
        data: ministryPerformance
      });
    } catch (error) {
      logger.error('Get ministry performance failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }
}

module.exports = new ReportController(); 
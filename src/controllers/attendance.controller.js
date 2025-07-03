const AttendanceService = require('../services/attendance.service');
const { schemas } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');

class AttendanceController {
  // GET /api/v1/attendance/event/:eventId
  async getEventAttendance(req, res, next) {
    try {
      const { includeBreakdown, includeTrends } = req.query;

      const stats = await AttendanceService.getEventAttendanceStats(req.params.eventId, {
        includeBreakdown: includeBreakdown === 'true',
        includeTrends: includeTrends === 'true'
      });

      const records = await AttendanceService.getAttendanceRecords(
        { scopedAccess: true, currentUserId: req.user.id, currentUserRole: req.user.role },
        { eventId: req.params.eventId, includeUserDetails: true, limit: 100 }
      );

      res.status(200).json({
        success: true,
        data: { statistics: stats, records: records.records, pagination: records.pagination }
      });
    } catch (error) {
      logger.error('Get event attendance failed', { error: error.message, eventId: req.params.eventId, requestedBy: req.user.id });
      next(error);
    }
  }

  // POST /api/v1/attendance
  async markAttendance(req, res, next) {
    try {
      const { error } = schemas.attendance.mark.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const attendance = await AttendanceService.markAttendance(
        req.body, req.user.id, req.user.role, req.ip || req.connection.remoteAddress
      );

      res.status(201).json({
        success: true,
        message: 'Attendance marked successfully',
        data: { attendance }
      });
    } catch (error) {
      logger.error('Mark attendance failed', { error: error.message, markedBy: req.user.id });
      next(error);
    }
  }

  // POST /api/v1/attendance/bulk
  async bulkMarkAttendance(req, res, next) {
    try {
      const { error } = schemas.attendance.bulkMark.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const results = await AttendanceService.markBulkAttendance(
        req.body, req.user.id, req.user.role, req.ip || req.connection.remoteAddress
      );

      res.status(200).json({
        success: true,
        message: `Bulk attendance completed. ${results.successful.length} new, ${results.updated.length} updated`,
        data: results
      });
    } catch (error) {
      logger.error('Bulk mark attendance failed', { error: error.message, markedBy: req.user.id });
      next(error);
    }
  }

  // PUT /api/v1/attendance/:id
  async updateAttendance(req, res, next) {
    try {
      const existingAttendance = await AttendanceService.getAttendanceById(req.params.id);
      const { eventId, userId, status, notes, location } = req.body;

      const updatedAttendance = await AttendanceService.markAttendance({
        eventId: eventId || existingAttendance.eventId._id,
        userId: userId || existingAttendance.userId._id,
        status: status || existingAttendance.status,
        notes: notes !== undefined ? notes : existingAttendance.notes,
        location: location !== undefined ? location : existingAttendance.location
      }, req.user.id, req.user.role, req.ip || req.connection.remoteAddress);

      res.status(200).json({
        success: true,
        message: 'Attendance updated successfully',
        data: { attendance: updatedAttendance }
      });
    } catch (error) {
      logger.error('Update attendance failed', { error: error.message, attendanceId: req.params.id, updatedBy: req.user.id });
      next(error);
    }
  }

  // POST /api/v1/attendance/event/:eventId/close
  async closeEvent(req, res, next) {
    try {
      // This would typically update the event status through EventService
      const EventService = require('../services/event.service');
      const event = await EventService.updateEvent(
        req.params.eventId,
        { status: 'completed' },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      res.status(200).json({
        success: true,
        message: 'Event closed successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Close event failed', { error: error.message, eventId: req.params.eventId, closedBy: req.user.id });
      next(error);
    }
  }

  // GET /api/v1/attendance/user/:userId/history
  async getMemberHistory(req, res, next) {
    try {
      const { timeframe, eventType, departmentId, includeHistory, page, limit } = req.query;

      const stats = await AttendanceService.getUserAttendanceStats(req.params.userId, {
        timeframe: parseInt(timeframe) || 90,
        eventType, departmentId,
        includeHistory: includeHistory === 'true'
      });

      const records = await AttendanceService.getAttendanceRecords(
        { scopedAccess: true, currentUserId: req.user.id, currentUserRole: req.user.role },
        { userId: req.params.userId, includeEventDetails: true, page: parseInt(page) || 1, limit: parseInt(limit) || 50 }
      );

      res.status(200).json({
        success: true,
        data: { statistics: stats, records: records.records, pagination: records.pagination }
      });
    } catch (error) {
      logger.error('Get member history failed', { error: error.message, userId: req.params.userId, requestedBy: req.user.id });
      next(error);
    }
  }

  // DELETE /api/v1/attendance/:id
  async deleteAttendance(req, res, next) {
    try {
      // Get the attendance record first
      const attendance = await AttendanceService.getAttendanceById(req.params.id);
      
      // Check if user can delete this attendance record
      if (req.user.role !== 'super_admin' && attendance.markedBy.toString() !== req.user.id.toString()) {
        return next(ApiError.forbidden('Cannot delete attendance record'));
      }

      // Delete the attendance record
      const Attendance = require('../models/Attendance.model');
      await Attendance.findByIdAndDelete(req.params.id);

      res.status(200).json({
        success: true,
        message: 'Attendance record deleted successfully'
      });
    } catch (error) {
      logger.error('Delete attendance failed', { error: error.message, attendanceId: req.params.id, deletedBy: req.user.id });
      next(error);
    }
  }

  // POST /api/v1/attendance/import
  async bulkImportAttendance(req, res, next) {
    try {
      const { attendanceData } = req.body; // Array of attendance records

      if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
        return next(ApiError.badRequest('Attendance data array is required'));
      }

      const results = { successful: [], failed: [] };

      for (const record of attendanceData) {
        try {
          const attendance = await AttendanceService.markAttendance(
            record, req.user.id, req.user.role, req.ip || req.connection.remoteAddress
          );
          results.successful.push({ ...record, attendanceId: attendance._id });
        } catch (error) {
          results.failed.push({ ...record, error: error.message });
        }
      }

      res.status(200).json({
        success: true,
        message: `Import completed. ${results.successful.length} successful, ${results.failed.length} failed`,
        data: results
      });
    } catch (error) {
      logger.error('Bulk import attendance failed', { error: error.message, importedBy: req.user.id });
      next(error);
    }
  }

  // GET /api/v1/attendance/stats
  async getAttendanceStats(req, res, next) {
    try {
      const { startDate, endDate, groupBy, departmentId, eventType } = req.query;
      
      const options = {
        startDate,
        endDate,
        groupBy: groupBy || 'status', // status, event, department, user
        departmentId,
        eventType
      };

      const stats = await AttendanceService.getAttendanceStatistics(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: { stats }
      });
    } catch (error) {
      logger.error('Get attendance stats failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/attendance/export
  async exportAttendance(req, res, next) {
    try {
      const { startDate, endDate, format, eventId, departmentId } = req.query;
      
      if (!startDate || !endDate) {
        return next(ApiError.badRequest('Start date and end date are required'));
      }

      const filters = {
        startDate,
        endDate,
        eventId,
        departmentId
      };

      const records = await AttendanceService.getAttendanceRecords(
        { scopedAccess: true, currentUserId: req.user.id, currentUserRole: req.user.role },
        { ...filters, includeUserDetails: true, includeEventDetails: true, limit: 10000 }
      );

      if (format === 'csv') {
        const csv = this.convertToCSV(records.records);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${startDate}_${endDate}.csv`);
        res.status(200).send(csv);
      } else {
        res.status(200).json({
          success: true,
          data: records
        });
      }
    } catch (error) {
      logger.error('Export attendance failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // Helper method to convert attendance records to CSV
  convertToCSV(records) {
    const headers = [
      'Date', 'Event', 'Event Type', 'Member Name', 'Phone Number', 
      'Department', 'Status', 'Marked By', 'Notes'
    ];
    
    const rows = records.map(record => [
      new Date(record.createdAt).toLocaleDateString(),
      record.eventId?.title || '',
      record.eventId?.eventType || '',
      record.userId?.fullName || '',
      record.userId?.phoneNumber || '',
      record.userId?.departmentId?.name || '',
      record.status,
      record.markedBy?.fullName || '',
      record.notes || ''
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}

module.exports = new AttendanceController(); 
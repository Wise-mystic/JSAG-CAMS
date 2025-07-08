const AttendanceService = require('../services/attendance.service');
const { schemas } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const { EVENT_STATUS } = require('../utils/constants');

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

      // Transform field names to match service expectations
      const { event, user, status, notes, location } = req.body;
      const transformedData = {
        eventId: event,
        userId: user,
        status,
        notes,
        location,
        markedBy: req.user.id  // Use the authenticated user's ID
      };

      const attendance = await AttendanceService.markAttendance(
        transformedData, 
        req.user.id, 
        req.user.role, 
        req.ip || req.connection.remoteAddress
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

      // Transform field names to match service expectations
      const { event, attendances } = req.body;
      const transformedData = {
        eventId: event,
        attendanceRecords: attendances.map(record => ({
          userId: record.user,
          status: record.status,
          notes: record.notes,
          reason: record.reason
        }))
      };

      const results = await AttendanceService.markBulkAttendance(
        transformedData,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
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
      const attendanceId = req.params.attendanceId || req.params.id;
      const Attendance = require('../models/Attendance.model');
      
      logger.info('UPDATE: Starting attendance update', { attendanceId, userId: req.user.id, body: req.body });
      
      // RADICAL APPROACH: Direct database update, bypass service layer
      const existingAttendance = await Attendance.findById(attendanceId)
        .populate('eventId', 'title startTime endTime status')
        .populate('userId', 'fullName phoneNumber role')
        .populate('markedBy', 'fullName role');
      
      if (!existingAttendance) {
        logger.error('UPDATE: Attendance record not found in direct query', { attendanceId });
        return next(ApiError.notFound('Attendance record not found'));
      }
      
      logger.info('UPDATE: Found existing attendance', { 
        id: existingAttendance._id, 
        status: existingAttendance.status,
        eventTitle: existingAttendance.eventId?.title 
      });
      
      // Build update data
      const updateData = {};
      if (req.body.status) updateData.status = req.body.status;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes;
      if (req.body.location) updateData.location = req.body.location;
      if (req.body.event) updateData.eventId = req.body.event;
      if (req.body.user) updateData.userId = req.body.user;
      
      // Always update these fields
      updateData.markedBy = req.user.id;
      updateData.markedAt = new Date();
      
      logger.info('UPDATE: Applying update data', { updateData });
      
      // Perform direct update
      const updatedAttendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        { $set: updateData },
        { new: true, runValidators: true }
      ).populate('eventId', 'title startTime endTime status')
       .populate('userId', 'fullName phoneNumber role')
       .populate('markedBy', 'fullName role');
      
      if (!updatedAttendance) {
        logger.error('UPDATE: Failed to update attendance record', { attendanceId });
        return next(ApiError.internalError('Failed to update attendance record'));
      }
      
      logger.info('UPDATE: Attendance updated successfully', { 
        id: updatedAttendance._id, 
        newStatus: updatedAttendance.status 
      });

      res.status(200).json({
        success: true,
        message: 'Attendance updated successfully',
        data: { attendance: updatedAttendance }
      });
    } catch (error) {
      logger.error('Update attendance failed', { 
        error: error.message, 
        stack: error.stack,
        attendanceId: req.params.attendanceId || req.params.id, 
        updatedBy: req.user.id 
      });
      next(error);
    }
  }

  // POST /api/v1/attendance/event/:eventId/close
  async closeEvent(req, res, next) {
    try {
      const EventService = require('../services/event.service');
      const Event = require('../models/Event.model');
      const { EVENT_STATUS } = require('../utils/constants');
      
      logger.info('CLOSE EVENT: Starting event closure', { eventId: req.params.eventId, userId: req.user.id });
      
      // First, get the current event to check its current status
      const currentEvent = await Event.findById(req.params.eventId);
      
      if (!currentEvent) {
        logger.error('CLOSE EVENT: Event not found', { eventId: req.params.eventId });
        return next(ApiError.notFound('Event not found'));
      }

      logger.info('CLOSE EVENT: Current event status', { 
        eventId: req.params.eventId, 
        currentStatus: currentEvent.status 
      });

      // FIXED: Smart status determination with proper transitions
      let newStatus;
      
      if (currentEvent.status === EVENT_STATUS.COMPLETED) {
        newStatus = EVENT_STATUS.CLOSED;
      } else if (currentEvent.status === EVENT_STATUS.UPCOMING) {
        // For upcoming events, first complete them, then close in next call
        newStatus = EVENT_STATUS.COMPLETED;
      } else if (currentEvent.status === EVENT_STATUS.STARTED || currentEvent.status === EVENT_STATUS.ACTIVE) {
        newStatus = EVENT_STATUS.COMPLETED;
      } else {
        logger.error('CLOSE EVENT: Invalid current status for closing', { 
          eventId: req.params.eventId, 
          currentStatus: currentEvent.status 
        });
        return next(ApiError.badRequest(
          `Cannot close event with current status: ${currentEvent.status}. ` +
          `Event must be completed before closing.`
        ));
      }

      logger.info('CLOSE EVENT: Transitioning status', { 
        eventId: req.params.eventId, 
        from: currentEvent.status, 
        to: newStatus 
      });

      const event = await EventService.updateEvent(
        req.params.eventId,
        { status: newStatus },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      const message = newStatus === EVENT_STATUS.CLOSED 
        ? 'Event closed successfully' 
        : 'Event completed successfully (call again to close)';

      logger.info('CLOSE EVENT: Successfully updated event', { 
        eventId: req.params.eventId, 
        newStatus: event.status 
      });

      res.status(200).json({
        success: true,
        message,
        data: { event }
      });
    } catch (error) {
      logger.error('Close event failed', { 
        error: error.message, 
        stack: error.stack,
        eventId: req.params.eventId, 
        closedBy: req.user.id 
      });
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
      // Check if attendance record exists first
      const Attendance = require('../models/Attendance.model');
      const attendance = await Attendance.findById(req.params.id);
      
      if (!attendance) {
        return next(ApiError.notFound('Attendance record not found'));
      }
      
      // Check if user can delete this attendance record
      if (req.user.role !== 'super-admin' && attendance.markedBy.toString() !== req.user.id.toString()) {
        return next(ApiError.forbidden('Cannot delete attendance record'));
      }

      // Delete the attendance record
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

  // DEBUG ENDPOINT - Test direct database access
  async debugAttendance(req, res, next) {
    try {
      const attendanceId = req.params.attendanceId;
      const Attendance = require('../models/Attendance.model');
      
      logger.info('DEBUG: Starting attendance debug', { attendanceId, userId: req.user.id });
      
      // Test 1: Direct MongoDB query
      const directResult = await Attendance.findById(attendanceId);
      logger.info('DEBUG: Direct query result', { found: !!directResult, id: directResult?._id });
      
      // Test 2: Service layer query
      let serviceResult = null;
      let serviceError = null;
      try {
        serviceResult = await AttendanceService.getAttendanceById(attendanceId);
        logger.info('DEBUG: Service query result', { found: !!serviceResult, id: serviceResult?._id });
      } catch (err) {
        serviceError = err.message;
        logger.error('DEBUG: Service query failed', { error: err.message });
      }
      
      // Test 3: Check database connection
      const dbStatus = require('mongoose').connection.readyState;
      const dbName = require('mongoose').connection.name;
      logger.info('DEBUG: Database status', { readyState: dbStatus, dbName });
      
      res.status(200).json({
        success: true,
        debug: {
          attendanceId,
          directQuery: {
            found: !!directResult,
            result: directResult ? {
              id: directResult._id,
              status: directResult.status,
              eventId: directResult.eventId,
              userId: directResult.userId
            } : null
          },
          serviceQuery: {
            found: !!serviceResult,
            error: serviceError,
            result: serviceResult ? {
              id: serviceResult._id,
              status: serviceResult.status
            } : null
          },
          database: {
            readyState: dbStatus,
            dbName,
            states: { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }
          }
        }
      });
    } catch (error) {
      logger.error('Debug attendance failed', { error: error.message, attendanceId: req.params.attendanceId });
      next(error);
    }
  }
}

module.exports = new AttendanceController(); 
const EventService = require('../services/event.service');
const { schemas } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');

class EventController {
  // GET /api/v1/events
  async listEvents(req, res, next) {
    try {
      const { page, limit, sort, search, eventType, status, startDate, endDate, includeAttendance, scopeId, scopeType } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        sort: sort || '-startTime',
        search,
        type: eventType,
        status,
        startDate,
        endDate,
        includeAttendance: includeAttendance === 'true',
        scopeId,
        scopeType
      };

      const result = await EventService.getAllEvents(req.user.id, req.user.role, {}, options);

      logger.info('Events retrieved successfully', {
        userId: req.user.id,
        count: result.events.length,
        filters: options
      });

      res.status(200).json({
        success: true,
        data: result.events,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('List events failed', { 
        error: error.message, 
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/events
  async createEvent(req, res, next) {
    try {
      const { error } = schemas.event.create.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const event = await EventService.createEvent(
        req.body,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event created successfully', {
        eventId: event._id,
        title: event.title,
        type: event.type,
        createdBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'Event created successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Create event failed', { 
        error: error.message, 
        userId: req.user.id,
        eventData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/events/:id
  async getEvent(req, res, next) {
    try {
      const event = await EventService.getEventById(
        req.params.id,
        req.user.id,
        req.user.role
      );

      res.status(200).json({
        success: true,
        data: { event }
      });
    } catch (error) {
      logger.error('Get event failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id
      });
      next(error);
    }
  }

  // PUT /api/v1/events/:id
  async updateEvent(req, res, next) {
    try {
      const { error } = schemas.event.update.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      const event = await EventService.updateEvent(
        req.params.id,
        req.body,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event updated successfully', {
        eventId: req.params.id,
        updatedBy: req.user.id,
        changes: Object.keys(req.body),
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Event updated successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Update event failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id,
        updateData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // PUT /api/v1/events/:id/status
  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      
      if (!status) {
        return next(ApiError.badRequest('Status is required'));
      }

      const event = await EventService.updateEvent(
        req.params.id,
        { status },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event status updated successfully', {
        eventId: req.params.id,
        newStatus: status,
        updatedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Event status updated successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Update event status failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id,
        status: req.body.status,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // DELETE /api/v1/events/:id
  async deleteEvent(req, res, next) {
    try {
      const result = await EventService.deleteEvent(
        req.params.id,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event deleted/cancelled successfully', {
        eventId: req.params.id,
        deletedBy: req.user.id,
        action: result.cancelled ? 'cancelled' : 'deleted',
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: { 
          cancelled: result.cancelled || false,
          deleted: result.deleted || false
        }
      });
    } catch (error) {
      logger.error('Delete event failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/events/:id/participants
  async addParticipants(req, res, next) {
    try {
      const { userId } = req.body;
      const participantId = userId || req.user.id; // Allow registering others if authorized

      const result = await EventService.registerForEvent(
        req.params.id,
        participantId,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Participant added to event', {
        eventId: req.params.id,
        participantId,
        addedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error('Add participant failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id,
        participantId: req.body.userId,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/events/:id/participants
  async getParticipants(req, res, next) {
    try {
      const event = await EventService.getEventById(
        req.params.id,
        req.user.id,
        req.user.role
      );

      res.status(200).json({
        success: true,
        data: {
          eventId: req.params.id,
          participants: event.participants || [],
          totalParticipants: event.participants?.length || 0,
          maxParticipants: event.maxParticipants,
          registrationRequired: event.requiresRegistration
        }
      });
    } catch (error) {
      logger.error('Get participants failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id
      });
      next(error);
    }
  }

  // GET /api/v1/events/:id/attendance
  async getAttendance(req, res, next) {
    try {
      const event = await EventService.getEventById(
        req.params.id,
        req.user.id,
        req.user.role
      );

      res.status(200).json({
        success: true,
        data: {
          eventId: req.params.id,
          eventTitle: event.title,
          eventStatus: event.status,
          statistics: event.attendanceStats || {},
          records: event.recentAttendance || []
        }
      });
    } catch (error) {
      logger.error('Get attendance failed', { 
        error: error.message, 
        eventId: req.params.id,
        userId: req.user.id
      });
      next(error);
    }
  }

  // POST /api/v1/events/:id/duplicate
  async duplicateEvent(req, res, next) {
    try {
      const originalEvent = await EventService.getEventById(
        req.params.id,
        req.user.id,
        req.user.role
      );

      const { startTime, endTime, title } = req.body;

      // Prepare duplicate data
      const duplicateData = {
        title: title || `${originalEvent.title} (Copy)`,
        description: originalEvent.description,
        eventType: originalEvent.eventType,
        startTime: startTime || originalEvent.startTime,
        endTime: endTime || originalEvent.endTime,
        departmentId: originalEvent.departmentId,
        targetAudience: originalEvent.targetAudience,
        targetIds: originalEvent.targetIds,
        location: originalEvent.location,
        settings: originalEvent.settings,
        isRecurring: false, // Don't duplicate recurring settings
        recurrenceRule: null
      };

      const duplicatedEvent = await EventService.createEvent(
        duplicateData,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event duplicated successfully', {
        originalEventId: req.params.id,
        duplicatedEventId: duplicatedEvent._id,
        duplicatedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'Event duplicated successfully',
        data: { event: duplicatedEvent }
      });
    } catch (error) {
      logger.error('Duplicate event failed', { 
        error: error.message, 
        originalEventId: req.params.id,
        userId: req.user.id,
        duplicateData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/events/recurring
  async recurEvent(req, res, next) {
    try {
      const { error } = schemas.event.create.validate(req.body);
      if (error) {
        return next(ApiError.badRequest(error.details[0].message));
      }

      if (!req.body.isRecurring) {
        return next(ApiError.badRequest('isRecurring must be true for recurring events'));
      }

      if (!req.body.recurrenceRule) {
        return next(ApiError.badRequest('recurrenceRule is required for recurring events'));
      }

      const event = await EventService.createEvent(
        req.body,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Recurring event created successfully', {
        eventId: event._id,
        title: event.title,
        recurrenceRule: event.recurrenceRule,
        createdBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'Recurring event created successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Create recurring event failed', { 
        error: error.message, 
        userId: req.user.id,
        eventData: req.body,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/events/dashboard
  async getDashboard(req, res, next) {
    try {
      const { timeframe, includeStats } = req.query;
      
      const options = {
        timeframe: timeframe || '30',
        includeStats: includeStats !== 'false'
      };

      const dashboard = await EventService.getEventsDashboard(
        req.user.id,
        req.user.role,
        options
      );

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error('Get events dashboard failed', { 
        error: error.message, 
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // DELETE /api/v1/events/:id/participants/:userId
  async removeParticipant(req, res, next) {
    try {
      const { id: eventId, userId: participantId } = req.params;

      const result = await EventService.unregisterFromEvent(
        eventId,
        participantId,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Participant removed from event', {
        eventId,
        participantId,
        removedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error('Remove participant failed', { 
        error: error.message, 
        eventId: req.params.id,
        participantId: req.params.userId,
        removedBy: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // GET /api/v1/events/upcoming
  async getUpcomingEvents(req, res, next) {
    try {
      const { page, limit, days } = req.query;
      
      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        days: parseInt(days) || 30,
        status: ['upcoming', 'published'],
        sort: 'startTime'
      };

      const result = await EventService.getAllEvents(req.user.id, req.user.role, {}, options);

      res.status(200).json({
        success: true,
        data: result.events,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get upcoming events failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/events/calendar
  async getCalendarEvents(req, res, next) {
    try {
      const { startDate, endDate, view } = req.query;
      
      if (!startDate || !endDate) {
        return next(ApiError.badRequest('Start date and end date are required'));
      }

      const options = {
        startDate,
        endDate,
        view: view || 'month',
        includeRecurring: true
      };

      const events = await EventService.getCalendarView(req.user.id, req.user.role, options);

      res.status(200).json({
        success: true,
        data: { events }
      });
    } catch (error) {
      logger.error('Get calendar events failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/events/my-events
  async getMyEvents(req, res, next) {
    try {
      const { page, limit, startDate, endDate, role } = req.query;
      
      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        startDate,
        endDate,
        role: role || 'all' // all, organizer, participant
      };

      const result = await EventService.getUserEvents(req.user.id, options);

      res.status(200).json({
        success: true,
        data: result.events,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Get my events failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // GET /api/v1/events/stats
  async getEventStats(req, res, next) {
    try {
      const { startDate, endDate, groupBy } = req.query;
      
      const options = {
        startDate,
        endDate,
        groupBy: groupBy || 'type' // type, status, department
      };

      const stats = await EventService.getEventStatistics(req.user.id, req.user.role, options);

      res.status(200).json({
        success: true,
        data: { stats }
      });
    } catch (error) {
      logger.error('Get event stats failed', {
        error: error.message,
        userId: req.user.id,
        query: req.query
      });
      next(error);
    }
  }

  // POST /api/v1/events/:id/cancel
  async cancelEvent(req, res, next) {
    try {
      const { reason, notifyParticipants } = req.body;
      
      const result = await EventService.cancelEvent(
        req.params.id,
        reason,
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress,
        notifyParticipants
      );

      logger.info('Event cancelled successfully', {
        eventId: req.params.id,
        cancelledBy: req.user.id,
        reason,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: { event: result.event }
      });
    } catch (error) {
      logger.error('Cancel event failed', {
        error: error.message,
        eventId: req.params.id,
        userId: req.user.id,
        reason: req.body.reason,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/events/:id/publish
  async publishEvent(req, res, next) {
    try {
      const event = await EventService.updateEvent(
        req.params.id,
        { status: 'published' },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event published successfully', {
        eventId: req.params.id,
        publishedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Event published successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Publish event failed', {
        error: error.message,
        eventId: req.params.id,
        userId: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }

  // POST /api/v1/events/:id/close
  async closeEvent(req, res, next) {
    try {
      const event = await EventService.updateEvent(
        req.params.id,
        { status: 'completed', closedAt: new Date() },
        req.user.id,
        req.user.role,
        req.ip || req.connection.remoteAddress
      );

      logger.info('Event closed successfully', {
        eventId: req.params.id,
        closedBy: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        message: 'Event closed successfully',
        data: { event }
      });
    } catch (error) {
      logger.error('Close event failed', {
        error: error.message,
        eventId: req.params.id,
        userId: req.user.id,
        ipAddress: req.ip
      });
      next(error);
    }
  }
}

module.exports = new EventController(); 
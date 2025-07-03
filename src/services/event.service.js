// Event Service
// Handles event CRUD, status, participants, duplication, and recurrence logic

const Event = require('../models/Event.model');
const User = require('../models/User.model');
const Department = require('../models/Department.model');
const Ministry = require('../models/Ministry.model');
const PrayerTribe = require('../models/PrayerTribe.model');
const Attendance = require('../models/Attendance.model');
const AuditLog = require('../models/AuditLog.model');
const { ApiError } = require('../middleware/error.middleware');
const { 
  USER_ROLES, 
  EVENT_TYPES, 
  EVENT_STATUS,
  TARGET_AUDIENCE,
  ROLE_HIERARCHY,
  ERROR_CODES, 
  AUDIT_ACTIONS,
  SUCCESS_MESSAGES 
} = require('../utils/constants');
const mongoose = require('mongoose');
const cron = require('node-cron');

class EventService {
  constructor() {
    this.setupEventAutomation();
  }

  /**
   * Get all events with filtering and scoped access
   */
  async getAllEvents(userId, userRole, filters = {}, options = {}) {
    const {
      page = 1,
      limit = 20,
      sort = '-startTime',
      search,
      type,
      status,
      startDate,
      endDate,
      includeAttendance = false,
      scopeId,
      scopeType
    } = options;

    const query = {};

    // Apply scoped access based on user role
    const scopedQuery = this.applyScopedAccess(userId, userRole, scopeId, scopeType);
    Object.assign(query, scopedQuery);

    // Apply filters
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    if (type) query.type = type;
    if (status) query.status = status;

    // Date range filtering
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      Event.find(query)
        .populate('createdBy', 'fullName role')
        .populate('departmentId', 'name')
        .populate('ministryId', 'name')
        .populate('prayerTribeId', 'name dayOfWeek')
        .populate('assignedClockerId', 'fullName phoneNumber')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Event.countDocuments(query)
    ]);

    // Include attendance data if requested
    if (includeAttendance) {
      const eventIds = events.map(e => e._id);
      const attendanceStats = await this.getAttendanceStatsForEvents(eventIds);
      
      events.forEach(event => {
        const stats = attendanceStats.find(s => s._id.toString() === event._id.toString());
        event.attendanceStats = stats || { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
      });
    }

    return {
      events,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalEvents: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get event by ID with access control
   */
  async getEventById(eventId, userId, userRole) {
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw ApiError.badRequest('Invalid event ID', ERROR_CODES.INVALID_INPUT);
    }

    const event = await Event.findById(eventId)
      .populate('createdBy', 'fullName role phoneNumber')
      .populate('departmentId', 'name leaderId')
      .populate('ministryId', 'name leaderId')
      .populate('prayerTribeId', 'name dayOfWeek')
      .populate('assignedClockerId', 'fullName phoneNumber role')
      .populate('participants.userId', 'fullName phoneNumber role');

    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check access permissions
    if (!this.canAccessEvent(userId, userRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Get attendance statistics
    const attendanceStats = await this.getEventAttendanceStats(eventId);
    
    // Get recent attendance records
    const recentAttendance = await Attendance.find({ eventId })
      .populate('userId', 'fullName role')
      .sort('-createdAt')
      .limit(50);

    return {
      ...event.toObject(),
      attendanceStats,
      recentAttendance
    };
  }

  /**
   * Create new event with validation and scope enforcement
   */
  async createEvent(eventData, createdBy, createdByRole, ipAddress) {
    const {
      title,
      description,
      type,
      startTime,
      endTime,
      location,
      isRecurring = false,
      recurringPattern,
      maxParticipants,
      requiresRegistration = false,
      autoCloseAfterHours = 3,
      departmentId,
      ministryId,
      prayerTribeId,
      assignedClockerId,
      tags = [],
      settings = {}
    } = eventData;

    // Validate creator permissions
    if (!this.canCreateEvents(createdByRole)) {
      throw ApiError.forbidden(
        'Insufficient permissions to create events',
        ERROR_CODES.INSUFFICIENT_PERMISSIONS
      );
    }

    // Validate scope access for clockers
    if (createdByRole === USER_ROLES.CLOCKER) {
      const hasAccess = await this.validateClockerScope(
        createdBy,
        { departmentId, ministryId, prayerTribeId }
      );
      if (!hasAccess) {
        throw ApiError.forbidden(
          'You can only create events for your assigned groups',
          ERROR_CODES.SCOPE_ACCESS_DENIED
        );
      }
    }

    // Validate event timing
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    
    if (startDate >= endDate) {
      throw ApiError.badRequest(
        'End time must be after start time',
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (startDate < new Date()) {
      throw ApiError.badRequest(
        'Cannot create events in the past',
        ERROR_CODES.INVALID_INPUT
      );
    }

    // Validate assigned clocker
    if (assignedClockerId) {
      const clocker = await User.findById(assignedClockerId);
      if (!clocker || clocker.role !== USER_ROLES.CLOCKER) {
        throw ApiError.badRequest(
          'Invalid clocker assignment',
          ERROR_CODES.INVALID_INPUT
        );
      }
    }

    // Check for conflicting events
    const conflicts = await this.checkEventConflicts(
      startTime,
      endTime,
      { departmentId, ministryId, prayerTribeId }
    );

    if (conflicts.length > 0) {
      throw ApiError.conflict(
        `Event conflicts with existing event: ${conflicts[0].title}`,
        ERROR_CODES.EVENT_CONFLICT
      );
    }

    // Create the event
    const event = new Event({
      title,
      description,
      type,
      startTime: startDate,
      endTime: endDate,
      location,
      isRecurring,
      recurringPattern,
      maxParticipants,
      requiresRegistration,
      autoCloseAfterHours,
      departmentId,
      ministryId,
      prayerTribeId,
      assignedClockerId,
      tags,
      settings,
      createdBy,
      status: EVENT_STATUS.UPCOMING
    });

    await event.save();

    // Handle recurring events
    if (isRecurring && recurringPattern) {
      await this.createRecurringEventInstances(event, recurringPattern);
    }

    // Schedule auto-closure
    this.scheduleEventAutoClosure(event._id, endDate, autoCloseAfterHours);

    // Log event creation
    await AuditLog.logAction({
      userId: createdBy,
      action: AUDIT_ACTIONS.EVENT_CREATE,
      resource: 'event',
      resourceId: event._id,
      details: {
        title,
        type,
        startTime,
        endTime,
        isRecurring,
        scope: { departmentId, ministryId, prayerTribeId }
      },
      ipAddress,
      result: { success: true }
    });

    return await this.getEventById(event._id, createdBy, createdByRole);
  }

  /**
   * Update event with validation
   */
  async updateEvent(eventId, updateData, updatedBy, updatedByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyEvent(updatedBy, updatedByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Prevent modification of completed events
    if (event.status === EVENT_STATUS.COMPLETED) {
      throw ApiError.badRequest(
        'Cannot modify completed events',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    const {
      title,
      description,
      startTime,
      endTime,
      location,
      maxParticipants,
      assignedClockerId,
      tags,
      settings,
      status
    } = updateData;

    const updatePayload = {};
    const changes = {};

    // Update basic fields
    if (title && title !== event.title) {
      updatePayload.title = title;
      changes.title = { from: event.title, to: title };
    }

    if (description !== undefined && description !== event.description) {
      updatePayload.description = description;
      changes.description = { from: event.description, to: description };
    }

    if (location !== undefined && location !== event.location) {
      updatePayload.location = location;
      changes.location = { from: event.location, to: location };
    }

    // Update timing with validation
    if (startTime || endTime) {
      const newStartTime = startTime ? new Date(startTime) : event.startTime;
      const newEndTime = endTime ? new Date(endTime) : event.endTime;

      if (newStartTime >= newEndTime) {
        throw ApiError.badRequest(
          'End time must be after start time',
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Check for conflicts if times are changing
      if (startTime || endTime) {
        const conflicts = await this.checkEventConflicts(
          newStartTime,
          newEndTime,
          {
            departmentId: event.departmentId,
            ministryId: event.ministryId,
            prayerTribeId: event.prayerTribeId
          },
          eventId // Exclude current event
        );

        if (conflicts.length > 0) {
          throw ApiError.conflict(
            `Event conflicts with: ${conflicts[0].title}`,
            ERROR_CODES.EVENT_CONFLICT
          );
        }
      }

      if (startTime) {
        updatePayload.startTime = newStartTime;
        changes.startTime = { from: event.startTime, to: newStartTime };
      }

      if (endTime) {
        updatePayload.endTime = newEndTime;
        changes.endTime = { from: event.endTime, to: newEndTime };
      }
    }

    // Update participants limit
    if (maxParticipants !== undefined && maxParticipants !== event.maxParticipants) {
      updatePayload.maxParticipants = maxParticipants;
      changes.maxParticipants = { from: event.maxParticipants, to: maxParticipants };
    }

    // Update assigned clocker
    if (assignedClockerId !== undefined && assignedClockerId?.toString() !== event.assignedClockerId?.toString()) {
      if (assignedClockerId) {
        const clocker = await User.findById(assignedClockerId);
        if (!clocker || clocker.role !== USER_ROLES.CLOCKER) {
          throw ApiError.badRequest('Invalid clocker assignment', ERROR_CODES.INVALID_INPUT);
        }
      }
      updatePayload.assignedClockerId = assignedClockerId;
      changes.assignedClockerId = { from: event.assignedClockerId, to: assignedClockerId };
    }

    // Update tags
    if (tags !== undefined) {
      updatePayload.tags = tags;
      changes.tags = { from: event.tags, to: tags };
    }

    // Update settings
    if (settings !== undefined) {
      updatePayload.settings = { ...event.settings, ...settings };
      changes.settings = { from: event.settings, to: updatePayload.settings };
    }

    // Update status with validation
    if (status && status !== event.status) {
      if (!this.isValidStatusTransition(event.status, status)) {
        throw ApiError.badRequest(
          `Invalid status transition from ${event.status} to ${status}`,
          ERROR_CODES.INVALID_STATUS_TRANSITION
        );
      }
      updatePayload.status = status;
      changes.status = { from: event.status, to: status };
    }

    if (Object.keys(updatePayload).length === 0) {
      throw ApiError.badRequest('No valid updates provided', ERROR_CODES.INVALID_INPUT);
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      eventId,
      { ...updatePayload, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('createdBy departmentId ministryId prayerTribeId assignedClockerId');

    // Log event update
    await AuditLog.logAction({
      userId: updatedBy,
      action: AUDIT_ACTIONS.EVENT_UPDATE,
      resource: 'event',
      resourceId: eventId,
      details: { changes },
      ipAddress,
      result: { success: true }
    });

    return updatedEvent;
  }

  /**
   * Delete/Cancel event
   */
  async deleteEvent(eventId, deletedBy, deletedByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canDeleteEvent(deletedBy, deletedByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Check if event has attendance records
    const attendanceCount = await Attendance.countDocuments({ eventId });
    
    if (attendanceCount > 0 && event.status !== EVENT_STATUS.UPCOMING) {
      // Cancel instead of delete if there are attendance records
      event.status = EVENT_STATUS.CANCELLED;
      event.cancelledAt = new Date();
      event.cancelledBy = deletedBy;
      await event.save();

      await AuditLog.logAction({
        userId: deletedBy,
        action: AUDIT_ACTIONS.EVENT_CANCEL,
        resource: 'event',
        resourceId: eventId,
        details: { title: event.title, attendanceCount },
        ipAddress,
        result: { success: true }
      });

      return { success: true, message: 'Event cancelled successfully', cancelled: true };
    } else {
      // Safe to delete if no attendance records
      await Event.findByIdAndDelete(eventId);

      await AuditLog.logAction({
        userId: deletedBy,
        action: AUDIT_ACTIONS.EVENT_DELETE,
        resource: 'event',
        resourceId: eventId,
        details: { title: event.title },
        ipAddress,
        result: { success: true }
      });

      return { success: true, message: 'Event deleted successfully', deleted: true };
    }
  }

  /**
   * Register/Unregister for event
   */
  async registerForEvent(eventId, userId, registeredBy, registeredByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check if registration is required
    if (!event.requiresRegistration) {
      throw ApiError.badRequest(
        'This event does not require registration',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Check if event is open for registration
    if (event.status !== EVENT_STATUS.UPCOMING) {
      throw ApiError.badRequest(
        'Registration is not open for this event',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Check if user is already registered
    const isRegistered = event.participants.some(p => p.userId.toString() === userId.toString());
    if (isRegistered) {
      throw ApiError.conflict('User is already registered', ERROR_CODES.DUPLICATE_ENTRY);
    }

    // Check capacity
    if (event.maxParticipants && event.participants.length >= event.maxParticipants) {
      throw ApiError.badRequest(
        'Event is at full capacity',
        ERROR_CODES.CAPACITY_EXCEEDED
      );
    }

    // Add participant
    event.participants.push({
      userId,
      registeredAt: new Date(),
      registeredBy
    });

    await event.save();

    // Log registration
    await AuditLog.logAction({
      userId: registeredBy,
      action: AUDIT_ACTIONS.EVENT_REGISTER,
      resource: 'event',
      resourceId: eventId,
      details: { participantId: userId },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: 'Successfully registered for event' };
  }

  /**
   * Unregister from event
   */
  async unregisterFromEvent(eventId, userId, unregisteredBy, unregisteredByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check if user is registered
    const participantIndex = event.participants.findIndex(p => p.userId.toString() === userId.toString());
    if (participantIndex === -1) {
      throw ApiError.notFound('User is not registered for this event', ERROR_CODES.NOT_FOUND);
    }

    // Remove participant
    event.participants.splice(participantIndex, 1);
    await event.save();

    // Log unregistration
    await AuditLog.logAction({
      userId: unregisteredBy,
      action: AUDIT_ACTIONS.EVENT_UNREGISTER,
      resource: 'event',
      resourceId: eventId,
      details: { participantId: userId },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: 'Successfully unregistered from event' };
  }

  /**
   * Get event attendance statistics
   */
  async getEventAttendanceStats(eventId) {
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
    const present = stats.find(s => s._id === EVENT_STATUS.PRESENT)?.count || 0;
    const absent = stats.find(s => s._id === EVENT_STATUS.ABSENT)?.count || 0;
    const late = stats.find(s => s._id === EVENT_STATUS.LATE)?.count || 0;
    const excused = stats.find(s => s._id === EVENT_STATUS.EXCUSED)?.count || 0;

    return {
      total,
      present,
      absent,
      late,
      excused,
      attendanceRate: total > 0 ? parseFloat(((present + late) / total * 100).toFixed(2)) : 0,
      breakdown: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          percentage: total > 0 ? parseFloat((stat.count / total * 100).toFixed(2)) : 0
        };
        return acc;
      }, {})
    };
  }

  /**
   * Get events dashboard data
   */
  async getEventsDashboard(userId, userRole, options = {}) {
    const { timeframe = '30', includeStats = true } = options;

    const days = parseInt(timeframe) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Apply scoped access
    const scopedQuery = this.applyScopedAccess(userId, userRole);

    // Get events summary
    const eventsSummary = await Event.aggregate([
      {
        $match: {
          ...scopedQuery,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          events: { $push: { _id: '$_id', title: '$title', startTime: '$startTime' } }
        }
      }
    ]);

    // Get upcoming events
    const upcomingEvents = await Event.find({
      ...scopedQuery,
      status: EVENT_STATUS.UPCOMING,
      startTime: { $gte: new Date() }
    })
    .populate('createdBy departmentId ministryId assignedClockerId')
    .sort('startTime')
    .limit(10);

    // Get recent events
    const recentEvents = await Event.find({
      ...scopedQuery,
      status: { $in: [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED] }
    })
    .populate('createdBy departmentId ministryId')
    .sort('-createdAt')
    .limit(10);

    let attendanceStats = null;
    if (includeStats) {
      attendanceStats = await this.getDashboardAttendanceStats(scopedQuery, startDate);
    }

    return {
      summary: {
        total: eventsSummary.reduce((sum, stat) => sum + stat.count, 0),
        upcoming: eventsSummary.find(s => s._id === EVENT_STATUS.UPCOMING)?.count || 0,
        active: eventsSummary.find(s => s._id === EVENT_STATUS.ACTIVE)?.count || 0,
        completed: eventsSummary.find(s => s._id === EVENT_STATUS.COMPLETED)?.count || 0,
        cancelled: eventsSummary.find(s => s._id === EVENT_STATUS.CANCELLED)?.count || 0
      },
      upcomingEvents,
      recentEvents,
      attendanceStats,
      period: { days, startDate }
    };
  }

  // Helper methods
  applyScopedAccess(userId, userRole, scopeId = null, scopeType = null) {
    const query = {};

    // High-level roles can see all events
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return query;
    }

    // Department leaders can see their department events
    if (userRole === USER_ROLES.DEPARTMENT_LEADER) {
      query.$or = [
        { createdBy: new mongoose.Types.ObjectId(userId) },
        { departmentId: scopeId || null }
      ];
      return query;
    }

    // Clockers can see events in their scope
    if (userRole === USER_ROLES.CLOCKER) {
      query.$or = [
        { createdBy: new mongoose.Types.ObjectId(userId) },
        { assignedClockerId: new mongoose.Types.ObjectId(userId) }
      ];
      
      // Add scope-specific access
      if (scopeId && scopeType) {
        const scopeQuery = {};
        scopeQuery[`${scopeType}Id`] = new mongoose.Types.ObjectId(scopeId);
        query.$or.push(scopeQuery);
      }
      
      return query;
    }

    // Members can see events they're registered for or public events
    query.$or = [
      { 'participants.userId': new mongoose.Types.ObjectId(userId) },
      { requiresRegistration: false }
    ];

    return query;
  }

  async validateClockerScope(clockerId, eventScope) {
    const clocker = await User.findById(clockerId);
    if (!clocker || clocker.role !== USER_ROLES.CLOCKER) {
      return false;
    }

    // Check if clocker has access to the specified scope
    const { departmentId, ministryId, prayerTribeId } = eventScope;

    if (departmentId && clocker.departmentId?.toString() === departmentId.toString()) {
      return true;
    }

    if (ministryId && clocker.ministryId?.toString() === ministryId.toString()) {
      return true;
    }

    if (prayerTribeId && clocker.prayerTribes?.some(pt => pt.toString() === prayerTribeId.toString())) {
      return true;
    }

    return false;
  }

  async checkEventConflicts(startTime, endTime, scope, excludeEventId = null) {
    const query = {
      $or: [
        {
          startTime: { $lt: new Date(endTime) },
          endTime: { $gt: new Date(startTime) }
        }
      ],
      status: { $nin: [EVENT_STATUS.CANCELLED, EVENT_STATUS.COMPLETED] }
    };

    if (excludeEventId) {
      query._id = { $ne: excludeEventId };
    }

    // Check conflicts within the same scope
    const scopeQuery = { $or: [] };
    if (scope.departmentId) {
      scopeQuery.$or.push({ departmentId: scope.departmentId });
    }
    if (scope.ministryId) {
      scopeQuery.$or.push({ ministryId: scope.ministryId });
    }
    if (scope.prayerTribeId) {
      scopeQuery.$or.push({ prayerTribeId: scope.prayerTribeId });
    }

    if (scopeQuery.$or.length > 0) {
      query.$and = [query.$or[0], scopeQuery];
      delete query.$or;
    }

    return await Event.find(query).select('title startTime endTime');
  }

  async createRecurringEventInstances(baseEvent, pattern) {
    // Implementation for creating recurring event instances
    // This would create multiple event instances based on the pattern
    const instances = [];
    const { frequency, interval, endDate, daysOfWeek } = pattern;

    let currentDate = new Date(baseEvent.startTime);
    const endRecurring = new Date(endDate);
    const duration = baseEvent.endTime - baseEvent.startTime;

    while (currentDate <= endRecurring) {
      if (frequency === 'weekly' && daysOfWeek) {
        // Handle weekly recurring events
        for (const dayOfWeek of daysOfWeek) {
          const instanceDate = new Date(currentDate);
          instanceDate.setDate(instanceDate.getDate() + (dayOfWeek - instanceDate.getDay()));
          
          if (instanceDate <= endRecurring && instanceDate > baseEvent.startTime) {
            const instance = new Event({
              ...baseEvent.toObject(),
              _id: undefined,
              parentEventId: baseEvent._id,
              startTime: instanceDate,
              endTime: new Date(instanceDate.getTime() + duration),
              isRecurringInstance: true
            });
            
            instances.push(instance);
          }
        }
      }
      
      // Move to next interval
      if (frequency === 'daily') {
        currentDate.setDate(currentDate.getDate() + interval);
      } else if (frequency === 'weekly') {
        currentDate.setDate(currentDate.getDate() + (7 * interval));
      } else if (frequency === 'monthly') {
        currentDate.setMonth(currentDate.getMonth() + interval);
      }
    }

    if (instances.length > 0) {
      await Event.insertMany(instances);
    }

    return instances;
  }

  scheduleEventAutoClosure(eventId, endTime, hoursAfter) {
    const autoCloseTime = new Date(endTime);
    autoCloseTime.setHours(autoCloseTime.getHours() + hoursAfter);

    // In a real implementation, you would use a job queue like Bull
    setTimeout(async () => {
      try {
        await Event.findByIdAndUpdate(eventId, {
          status: EVENT_STATUS.COMPLETED,
          closedAt: new Date(),
          autoClosedAfterHours: hoursAfter
        });
      } catch (error) {
        console.error('Auto-close event failed:', error);
      }
    }, autoCloseTime.getTime() - Date.now());
  }

  setupEventAutomation() {
    // Set up cron jobs for event automation
    cron.schedule('0 */6 * * *', async () => {
      await this.processEventStatusUpdates();
    });

    cron.schedule('0 0 * * *', async () => {
      await this.cleanupOldEvents();
    });
  }

  async processEventStatusUpdates() {
    const now = new Date();

    // Update upcoming events to active when they start
    await Event.updateMany(
      {
        status: EVENT_STATUS.UPCOMING,
        startTime: { $lte: now }
      },
      {
        status: EVENT_STATUS.ACTIVE,
        activatedAt: now
      }
    );

    // Auto-close events that have exceeded their auto-close time
    const eventsToClose = await Event.find({
      status: EVENT_STATUS.ACTIVE,
      endTime: { $lt: new Date(now.getTime() - 3 * 60 * 60 * 1000) } // 3 hours ago
    });

    for (const event of eventsToClose) {
      await Event.findByIdAndUpdate(event._id, {
        status: EVENT_STATUS.COMPLETED,
        closedAt: now,
        autoClosedAfterHours: 3
      });
    }
  }

  async cleanupOldEvents() {
    // Archive events older than 1 year
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    await Event.updateMany(
      {
        status: EVENT_STATUS.COMPLETED,
        endTime: { $lt: oneYearAgo }
      },
      {
        isArchived: true,
        archivedAt: new Date()
      }
    );
  }

  async getAttendanceStatsForEvents(eventIds) {
    return await Attendance.aggregate([
      { $match: { eventId: { $in: eventIds } } },
      {
        $group: {
          _id: '$eventId',
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.PRESENT] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.ABSENT] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.LATE] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', EVENT_STATUS.EXCUSED] }, 1, 0] } }
        }
      }
    ]);
  }

  async getDashboardAttendanceStats(scopedQuery, startDate) {
    const eventIds = await Event.find(scopedQuery).distinct('_id');
    
    return await Attendance.aggregate([
      {
        $match: {
          eventId: { $in: eventIds },
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
  }

  // Permission checking methods
  canAccessEvent(userId, userRole, event) {
    // High-level roles can access all events
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Event creator can access their events
    if (event.createdBy?.toString() === userId.toString()) {
      return true;
    }

    // Assigned clocker can access the event
    if (event.assignedClockerId?.toString() === userId.toString()) {
      return true;
    }

    // Department leader can access department events
    if (userRole === USER_ROLES.DEPARTMENT_LEADER && event.departmentId) {
      return true; // Additional check would verify they lead this department
    }

    // Registered participants can access
    if (event.participants?.some(p => p.userId?.toString() === userId.toString())) {
      return true;
    }

    return false;
  }

  canCreateEvents(userRole) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.CLOCKER];
  }

  canModifyEvent(userId, userRole, event) {
    // High-level roles can modify any event
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Event creator can modify their events
    if (event.createdBy?.toString() === userId.toString()) {
      return true;
    }

    // Assigned clocker can modify the event
    if (event.assignedClockerId?.toString() === userId.toString()) {
      return true;
    }

    return false;
  }

  canDeleteEvent(userId, userRole, event) {
    // High-level roles can delete any event
    if (ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[USER_ROLES.ASSOCIATE_PASTOR]) {
      return true;
    }

    // Event creator can delete their events (if not started)
    if (event.createdBy?.toString() === userId.toString() && event.status === EVENT_STATUS.UPCOMING) {
      return true;
    }

    return false;
  }

  isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      [EVENT_STATUS.UPCOMING]: [EVENT_STATUS.ACTIVE, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.ACTIVE]: [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.COMPLETED]: [], // No transitions from completed
      [EVENT_STATUS.CANCELLED]: [] // No transitions from cancelled
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }
}

module.exports = new EventService(); 
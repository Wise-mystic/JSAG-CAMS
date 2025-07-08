// Event Service
// Handles event CRUD, status, participants, duplication, and recurrence logic

const Event = require('../models/Event.model');
const User = require('../models/User.model');
const Department = require('../models/Department.model');
const Ministry = require('../models/Ministry.model');
const PrayerTribe = require('../models/PrayerTribe.model');
const Subgroup = require('../models/Subgroup.model');
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
    if (status) {
      // Handle both single status and array of statuses
      if (Array.isArray(status)) {
        query.status = { $in: status };
      } else {
        query.status = status;
      }
    }

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
      eventType,
      startTime,
      endTime,
      location = {},
      isRecurring = false,
      recurringPattern = {},
      maxParticipants = null,
      requiresRegistration = false,
      autoCloseAfterHours = 3,
      departmentId = null,
      ministryId = null,
      prayerTribeId = null,
      assignedClockerId = null,
      tags = [],
      settings = {},
      targetAudience = 'all',
      targetIds = [],
      reminderTimes = [1440, 60],
      requiresAttendance = false,
      isPublic = false,
      sendReminders = true,
      groupSelection = {
        groupType: 'all',
        groupId: null,
        subgroupId: null,
        includeSubgroups: false,
        autoPopulateParticipants: false
      }
    } = eventData;

    // Validate event timing
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (startDate >= endDate) {
      throw ApiError.badRequest(
        'End time must be after start time',
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (startDate <= new Date()) {
      throw ApiError.badRequest(
        'Event start time must be in the future',
        ERROR_CODES.INVALID_INPUT
      );
    }

    // Check for conflicting events BEFORE creating the event
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

    // Validate group selection permissions
    if (groupSelection.groupType !== 'all' && groupSelection.groupType !== 'custom') {
      const availableGroups = await this.getAvailableGroupsForEventCreation(createdBy);
      if (!this.validateGroupSelectionPermissions(groupSelection, availableGroups, createdByRole)) {
        throw ApiError.forbidden(
          'Insufficient permissions for selected group',
          ERROR_CODES.ACCESS_DENIED
        );
      }
    }

    // Create the event (only after all validations pass)
    const event = new Event({
      title,
      description,
      eventType,
      startTime,
      endTime,
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
      settings: {
        ...settings,
        requiresRSVP: settings.requiresRSVP || false,
        maxParticipants: settings.maxParticipants || null,
        allowWalkIns: settings.allowWalkIns ?? true,
        sendReminders: settings.sendReminders ?? true,
        reminderTimes: settings.reminderTimes || [1440, 60]
      },
      targetAudience,
      targetIds,
      reminderTimes,
      requiresAttendance,
      isPublic,
      sendReminders,
      createdBy,
      expectedParticipants: [],
      actualParticipants: [],
      status: EVENT_STATUS.UPCOMING,
      groupSelection: {
        groupType: groupSelection.groupType || 'all',
        groupId: groupSelection.groupId || null,
        subgroupId: groupSelection.subgroupId || null,
        includeSubgroups: groupSelection.includeSubgroups || false,
        autoPopulateParticipants: groupSelection.autoPopulateParticipants || false,
        lastPopulatedAt: null
      }
    });

    await event.save();

    // Populate participants from group selection if requested
    if (groupSelection.autoPopulateParticipants && groupSelection.groupType !== 'custom') {
      try {
        await event.populateParticipantsFromGroups();
      } catch (error) {
        console.warn('Failed to auto-populate participants during event creation:', error.message);
        // Don't fail event creation if participant population fails
      }
    }

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
        eventType,
        startTime,
        endTime,
        isRecurring,
        scope: { departmentId, ministryId, prayerTribeId },
        groupSelection,
        participantsAutoPopulated: groupSelection.autoPopulateParticipants,
        participantCount: event.expectedParticipants.length
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

    const updatePayload = {};
    const changes = {};

    // Update status with validation using official constants
    const { status } = updateData;

    // Update status with validation
    if (status && status !== event.status) {
      // FIXED: Comprehensive valid transitions matching official EVENT_STATUS
      const validTransitions = {
        [EVENT_STATUS.DRAFT]: [EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELLED],
        [EVENT_STATUS.PUBLISHED]: [EVENT_STATUS.UPCOMING, EVENT_STATUS.CANCELLED],
        [EVENT_STATUS.UPCOMING]: [EVENT_STATUS.STARTED, EVENT_STATUS.ACTIVE, EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
        [EVENT_STATUS.STARTED]: [EVENT_STATUS.ACTIVE, EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
        [EVENT_STATUS.ACTIVE]: [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
        [EVENT_STATUS.COMPLETED]: [EVENT_STATUS.CLOSED],
        [EVENT_STATUS.CANCELLED]: [EVENT_STATUS.CLOSED]
      };

      const allowedTransitions = validTransitions[event.status] || [];
      if (!allowedTransitions.includes(status)) {
        throw ApiError.badRequest(
          `Invalid status transition from ${event.status} to ${status}. Allowed transitions: ${allowedTransitions.join(', ')}`,
          ERROR_CODES.INVALID_STATUS_TRANSITION
        );
      }

      updatePayload.status = status;
      changes.status = { from: event.status, to: status };

      // If starting the event, set the start time
      if (status === EVENT_STATUS.STARTED || status === EVENT_STATUS.ACTIVE) {
        updatePayload.startedAt = new Date();
        changes.startedAt = updatePayload.startedAt;
      }

      // If completing the event, set completion metadata
      if (status === EVENT_STATUS.COMPLETED) {
        updatePayload.completedAt = new Date();
        changes.completedAt = updatePayload.completedAt;
      }

      // If closing the event, set closure metadata
      if (status === EVENT_STATUS.CLOSED) {
        updatePayload.isClosed = true;
        updatePayload.closedAt = new Date();
        changes.isClosed = true;
        changes.closedAt = updatePayload.closedAt;
      }
    }

    // If no updates are provided, throw an error
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

    // Optional: Check if registration is required (commented out)
    // if (!event.requiresRegistration) {
    //   throw ApiError.badRequest(
    //     'This event does not require registration',
    //     ERROR_CODES.BUSINESS_RULE_VIOLATION
    //   );
    // }

    // Check if event is open for registration (allow authorized roles to bypass this check)
    const User = mongoose.model('User');
    const registerer = await User.findById(registeredBy);
    const authorizedRoles = ['super-admin', 'senior-pastor', 'associate-pastor', 'pastor', 'department-leader'];
    
    if (event.status !== EVENT_STATUS.UPCOMING && !authorizedRoles.includes(registerer?.role)) {
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

  /**
   * Get calendar view of events
   */
  async getCalendarView(userId, userRole, options = {}) {
    const { startDate, endDate, view = 'month', includeRecurring = true } = options;

    // Apply scoped access
    const scopedQuery = this.applyScopedAccess(userId, userRole);

    // Build query for date range
    const query = {
      ...scopedQuery,
      $or: [
        // Events that start within the range
        {
          startTime: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        },
        // Events that end within the range
        {
          endTime: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        },
        // Events that span the entire range
        {
          startTime: { $lte: new Date(startDate) },
          endTime: { $gte: new Date(endDate) }
        }
      ],
      status: { $nin: [EVENT_STATUS.CANCELLED] }
    };

    const events = await Event.find(query)
      .populate('createdBy', 'fullName')
      .populate('departmentId', 'name')
      .populate('ministryId', 'name')
      .populate('assignedClockerId', 'fullName')
      .sort('startTime');

    // Format events for calendar view
    const formattedEvents = events.map(event => ({
      id: event._id,
      title: event.title,
      start: event.startTime,
      end: event.endTime,
      allDay: false,
      color: this.getEventColor(event.eventType),
      extendedProps: {
        description: event.description,
        eventType: event.eventType,
        location: event.location,
        department: event.departmentId?.name,
        ministry: event.ministryId?.name,
        status: event.status,
        requiresRegistration: event.requiresRegistration,
        requiresAttendance: event.requiresAttendance,
        createdBy: event.createdBy?.fullName
      }
    }));

    return formattedEvents;
  }

  /**
   * Get events for a specific user (events they created or are participating in)
   */
  async getUserEvents(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      role = 'all' // all, organizer, participant
    } = options;

    const query = {};
    
    // Filter by date range if provided
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    // Filter by user role in the event
    if (role === 'organizer') {
      query.createdBy = userId;
    } else if (role === 'participant') {
      query['participants.userId'] = userId;
    } else {
      // 'all' - both organizer and participant
      query.$or = [
        { createdBy: userId },
        { 'participants.userId': userId },
        { 'expectedParticipants': userId }
      ];
    }

    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      Event.find(query)
        .populate('createdBy', 'fullName role')
        .populate('departmentId', 'name')
        .populate('ministryId', 'name')
        .populate('prayerTribeId', 'name dayOfWeek')
        .populate('assignedClockerId', 'fullName phoneNumber')
        .sort('-startTime') // Most recent events first
        .skip(skip)
        .limit(limit),
      Event.countDocuments(query)
    ]);

    // Add user-specific event data
    const enhancedEvents = events.map(event => {
      const eventObj = event.toObject();
      
      // Add user's role in this event
      if (event.createdBy && event.createdBy._id.toString() === userId.toString()) {
        eventObj.userRole = 'organizer';
      } else {
        eventObj.userRole = 'participant';
      }

      return eventObj;
    });

    return {
      events: enhancedEvents,
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
   * Get event statistics for reporting and analytics
   */
  async getEventStatistics(userId, userRole, options = {}) {
    const {
      startDate,
      endDate,
      groupBy = 'type', // type, status, department
      includeAttendance = true
    } = options;

    // Apply scoped access based on user role
    const scopedQuery = this.applyScopedAccess(userId, userRole);
    const query = { ...scopedQuery };

    // Apply date range filter
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    // Base aggregation pipeline
    const pipeline = [
      { $match: query }
    ];

    // Group by the specified field
    let groupField;
    switch (groupBy) {
      case 'type':
        groupField = '$eventType';
        break;
      case 'status':
        groupField = '$status';
        break;
      case 'department':
        groupField = '$departmentId';
        break;
      case 'month':
        pipeline.push({
          $addFields: {
            month: { $month: '$startTime' },
            year: { $year: '$startTime' }
          }
        });
        groupField = { month: '$month', year: '$year' };
        break;
      default:
        groupField = '$eventType';
    }

    // Add grouping stage
    pipeline.push({
      $group: {
        _id: groupField,
        count: { $sum: 1 },
        events: { $push: { 
          _id: '$_id', 
          title: '$title', 
          startTime: '$startTime', 
          endTime: '$endTime',
          status: '$status'
        }}
      }
    });

    // Add lookup for department names if grouping by department
    if (groupBy === 'department') {
      pipeline.push({
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'departmentInfo'
        }
      });
      pipeline.push({
        $addFields: {
          departmentName: { 
            $cond: {
              if: { $gt: [{ $size: '$departmentInfo' }, 0] },
              then: { $arrayElemAt: ['$departmentInfo.name', 0] },
              else: 'No Department'
            }
          }
        }
      });
    }

    // Add sort stage
    pipeline.push({ $sort: { count: -1 } });

    // Execute aggregation
    const stats = await Event.aggregate(pipeline);

    // Format results based on groupBy
    let formattedStats;
    switch (groupBy) {
      case 'type':
        formattedStats = stats.map(stat => ({
          type: stat._id || 'unknown',
          count: stat.count,
          events: stat.events
        }));
        break;
      case 'status':
        formattedStats = stats.map(stat => ({
          status: stat._id || 'unknown',
          count: stat.count,
          events: stat.events
        }));
        break;
      case 'department':
        formattedStats = stats.map(stat => ({
          departmentId: stat._id,
          departmentName: stat.departmentName || 'No Department',
          count: stat.count,
          events: stat.events
        }));
        break;
      case 'month':
        formattedStats = stats.map(stat => {
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                             'July', 'August', 'September', 'October', 'November', 'December'];
          return {
            month: stat._id.month,
            year: stat._id.year,
            monthName: monthNames[stat._id.month - 1],
            period: `${monthNames[stat._id.month - 1]} ${stat._id.year}`,
            count: stat.count,
            events: stat.events
          };
        });
        // Sort by year and month
        formattedStats.sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year;
          return a.month - b.month;
        });
        break;
      default:
        formattedStats = stats;
    }

    // Get total events
    const totalEvents = await Event.countDocuments(query);

    // Get attendance statistics if requested
    let attendanceStats = null;
    if (includeAttendance) {
      const eventIds = await Event.find(query).select('_id');
      const eventIdList = eventIds.map(e => e._id);
      
      if (eventIdList.length > 0) {
        attendanceStats = await this.getAttendanceStatsForEvents(eventIdList);
      }
    }

    return {
      totalEvents,
      groupBy,
      stats: formattedStats,
      dateRange: {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null
      },
      attendanceStats
    };
  }

  /**
   * Get event color based on type
   */
  getEventColor(eventType) {
    const colors = {
      meeting: '#4285F4',      // Blue
      service: '#0F9D58',      // Green
      prayer: '#9C27B0',       // Purple
      'bible-study': '#FF9800', // Orange
      fellowship: '#00BCD4',   // Cyan
      outreach: '#F44336',     // Red
      special: '#E91E63',      // Pink
      youth: '#3F51B5',        // Indigo
      children: '#FFC107',     // Amber
      women: '#FF5722',        // Deep Orange
      men: '#607D8B',          // Blue Grey
      leadership: '#795548',   // Brown
      training: '#009688',     // Teal
      conference: '#673AB7',   // Deep Purple
      retreat: '#8BC34A',      // Light Green
      workshop: '#03A9F4',     // Light Blue
      seminar: '#CDDC39',      // Lime
      fundraiser: '#FFEB3B',   // Yellow
      community: '#00E676',    // Green Accent
      volunteer: '#FF4081',    // Pink Accent
      other: '#9E9E9E'         // Grey
    };
    return colors[eventType] || colors.other;
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
      // Check for time overlap
      startTime: { $lt: new Date(endTime) },
      endTime: { $gt: new Date(startTime) },
      status: { $nin: [EVENT_STATUS.CANCELLED, EVENT_STATUS.COMPLETED] }
    };

    if (excludeEventId) {
      query._id = { $ne: excludeEventId };
    }

    // Only check conflicts if there's a scope specified
    if (scope.departmentId || scope.ministryId || scope.prayerTribeId) {
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
      
      // Add scope constraints to the query
      Object.assign(query, scopeQuery);
    } else {
      // If no scope, check for conflicts across all events
      // This prevents any time overlaps regardless of department/ministry
    }

    const conflicts = await Event.find(query).select('title startTime endTime');
    return conflicts;
  }

  async createRecurringEventInstances(eventId, pattern, userId, userRole, ipAddress) {
    // Get the base event
    const baseEvent = await Event.findById(eventId);
    if (!baseEvent) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyEvent(userId, userRole, baseEvent)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    const { frequency, interval, count, endDate, daysOfWeek } = pattern;
    const instances = [];
    
    let currentDate = new Date(baseEvent.startTime);
    const duration = baseEvent.endTime.getTime() - baseEvent.startTime.getTime();
    
    // Determine end condition
    let endCondition;
    let instancesCreated = 0;
    const maxInstances = count || 52; // Default max of 52 instances (1 year weekly)
    
    if (endDate) {
      endCondition = new Date(endDate);
    } else if (count) {
      endCondition = null; // Will use count instead
    } else {
      // Default to 1 year from now
      endCondition = new Date();
      endCondition.setFullYear(endCondition.getFullYear() + 1);
    }

    // Create recurring instances
    while (
      (endCondition ? currentDate <= endCondition : instancesCreated < maxInstances) && 
      instancesCreated < maxInstances
    ) {
      
      if (frequency === 'weekly' && daysOfWeek && Array.isArray(daysOfWeek)) {
        // Handle weekly recurring events with specific days
        for (const dayOfWeek of daysOfWeek) {
          if (instancesCreated >= maxInstances) break;
          
          const instanceDate = new Date(currentDate);
          const targetDay = parseInt(dayOfWeek); // 0 = Sunday, 1 = Monday, etc.
          const currentDay = instanceDate.getDay();
          const daysToAdd = (targetDay - currentDay + 7) % 7;
          
          instanceDate.setDate(instanceDate.getDate() + daysToAdd);
          
          if (instanceDate > baseEvent.startTime && 
              (!endCondition || instanceDate <= endCondition)) {
            
            const instance = new Event({
              ...baseEvent.toObject(),
              _id: undefined,
              parentEventId: baseEvent._id,
              startTime: instanceDate,
              endTime: new Date(instanceDate.getTime() + duration),
              isRecurringInstance: true,
              createdBy: userId,
              updatedBy: userId
            });
            
            instances.push(instance);
            instancesCreated++;
          }
        }
      } else {
        // Handle other frequencies (daily, weekly without specific days, monthly, yearly)
        if (currentDate > baseEvent.startTime && 
            (!endCondition || currentDate <= endCondition)) {
          
          const instance = new Event({
            ...baseEvent.toObject(),
            _id: undefined,
            parentEventId: baseEvent._id,
            startTime: new Date(currentDate),
            endTime: new Date(currentDate.getTime() + duration),
            isRecurringInstance: true,
            createdBy: userId,
            updatedBy: userId
          });
          
          instances.push(instance);
          instancesCreated++;
        }
      }
      
      // Move to next interval
      if (frequency === 'daily') {
        currentDate.setDate(currentDate.getDate() + (interval || 1));
      } else if (frequency === 'weekly') {
        currentDate.setDate(currentDate.getDate() + (7 * (interval || 1)));
      } else if (frequency === 'monthly') {
        currentDate.setMonth(currentDate.getMonth() + (interval || 1));
      } else if (frequency === 'yearly') {
        currentDate.setFullYear(currentDate.getFullYear() + (interval || 1));
      }
      
      // Safety check for count-based recurrence
      if (count && instancesCreated >= count) {
        break;
      }
    }

    // Save all instances
    let savedInstances = [];
    if (instances.length > 0) {
      savedInstances = await Event.insertMany(instances);
    }

    // Update the original event to mark it as recurring
    baseEvent.isRecurring = true;
    baseEvent.recurrencePattern = pattern;
    baseEvent.updatedBy = userId;
    await baseEvent.save();

    // Log action
    await AuditLog.logAction({
      userId,
      action: AUDIT_ACTIONS.EVENT_UPDATE,
      resource: 'event',
      resourceId: eventId,
      details: { 
        type: 'create_recurring_instances',
        pattern,
        instancesCreated: savedInstances.length
      },
      result: { success: true },
      ipAddress
    });

    return {
      originalEvent: baseEvent,
      recurringEvents: savedInstances,
      instancesCreated: savedInstances.length
    };
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

  /**
   * Update event group selection and populate participants
   */
  async updateEventGroupSelection(eventId, groupSelection, updatedBy, updatedByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyEvent(updatedBy, updatedByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Validate group selection based on user permissions
    const availableGroups = await event.getAvailableGroupsForUser(updatedBy);
    if (!this.validateGroupSelectionPermissions(groupSelection, availableGroups, updatedByRole)) {
      throw ApiError.forbidden('Insufficient permissions for selected group', ERROR_CODES.ACCESS_DENIED);
    }

    // Update group selection
    event.groupSelection = {
      ...event.groupSelection,
      ...groupSelection
    };

    await event.save();

    // Populate participants if auto-populate is enabled
    if (event.groupSelection.autoPopulateParticipants) {
      await event.populateParticipantsFromGroups();
    }

    // Log action
    await AuditLog.logAction({
      userId: updatedBy,
      action: AUDIT_ACTIONS.EVENT_UPDATE,
      resource: 'event',
      resourceId: eventId,
      details: { 
        groupSelection,
        participantsPopulated: event.groupSelection.autoPopulateParticipants
      },
      ipAddress,
      result: { success: true }
    });

    return { success: true, message: 'Event group selection updated successfully', event };
  }

  /**
   * Get available groups for event creation
   */
  async getAvailableGroupsForEventCreation(userId) {
    const event = new Event(); // Temporary event instance to access the method
    return await event.getAvailableGroupsForUser(userId);
  }

  /**
   * Populate event participants from group selection
   */
  async populateEventParticipants(eventId, populatedBy, populatedByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyEvent(populatedBy, populatedByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    const result = await event.populateParticipantsFromGroups();
    
    if (!result) {
      throw ApiError.badRequest(
        'Unable to populate participants. Check group selection configuration.',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Log action
    await AuditLog.logAction({
      userId: populatedBy,
      action: AUDIT_ACTIONS.EVENT_PARTICIPANT_ADD,
      resource: 'event',
      resourceId: eventId,
      details: { 
        method: 'group-population',
        participantCount: event.expectedParticipants.length,
        groupSelection: event.groupSelection
      },
      ipAddress,
      result: { success: true }
    });

    return { 
      success: true, 
      message: 'Participants populated successfully',
      participantCount: event.expectedParticipants.length,
      event 
    };
  }

  /**
   * Get subgroups for a parent group
   */
  async getSubgroupsForParent(parentType, parentId, userId, userRole) {
    // Check if user has access to the parent group
    const availableGroups = await this.getAvailableGroupsForEventCreation(userId);
    
    let hasAccess = false;
    switch (parentType) {
      case 'department':
        hasAccess = availableGroups.departments.some(dept => dept._id.toString() === parentId.toString());
        break;
      case 'ministry':
        hasAccess = availableGroups.ministries.some(ministry => ministry._id.toString() === parentId.toString());
        break;
      case 'prayer-tribe':
        hasAccess = availableGroups.prayerTribes.some(tribe => tribe._id.toString() === parentId.toString());
        break;
      default:
        return [];
    }

    if (!hasAccess && !['super-admin', 'senior-pastor', 'associate-pastor'].includes(userRole)) {
      throw ApiError.forbidden('Access denied to parent group', ERROR_CODES.ACCESS_DENIED);
    }

    return await Subgroup.findByParent(parentType, parentId);
  }

  /**
   * Add participants to event by group selection
   */
  async addParticipantsByGroupSelection(eventId, groupSelection, addedBy, addedByRole, ipAddress) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canModifyEvent(addedBy, addedByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Temporarily update group selection for participant population
    const originalGroupSelection = { ...event.groupSelection };
    event.groupSelection = {
      ...event.groupSelection,
      ...groupSelection,
      autoPopulateParticipants: true
    };

    const result = await event.populateParticipantsFromGroups();
    
    if (!result) {
      // Restore original group selection if population failed
      event.groupSelection = originalGroupSelection;
      await event.save();
      throw ApiError.badRequest(
        'Unable to add participants from group selection',
        ERROR_CODES.BUSINESS_RULE_VIOLATION
      );
    }

    // Log action
    await AuditLog.logAction({
      userId: addedBy,
      action: AUDIT_ACTIONS.EVENT_PARTICIPANT_ADD,
      resource: 'event',
      resourceId: eventId,
      details: { 
        method: 'group-selection',
        groupSelection,
        participantCount: event.expectedParticipants.length
      },
      ipAddress,
      result: { success: true }
    });

    return { 
      success: true, 
      message: 'Participants added successfully',
      participantCount: event.expectedParticipants.length,
      event 
    };
  }

  /**
   * Validate group selection permissions
   */
  validateGroupSelectionPermissions(groupSelection, availableGroups, userRole) {
    // Super admin and high-level roles can select any group
    if (['super-admin', 'senior-pastor', 'associate-pastor'].includes(userRole)) {
      return true;
    }

    const { groupType, groupId, subgroupId } = groupSelection;

    switch (groupType) {
      case 'all':
        return ['super-admin', 'senior-pastor', 'associate-pastor'].includes(userRole);
      
      case 'department':
        return availableGroups.departments.some(dept => dept._id.toString() === groupId.toString());
      
      case 'ministry':
        return availableGroups.ministries.some(ministry => ministry._id.toString() === groupId.toString());
      
      case 'prayer-tribe':
        return availableGroups.prayerTribes.some(tribe => tribe._id.toString() === groupId.toString());
      
      case 'subgroup':
        return availableGroups.subgroups.some(subgroup => subgroup._id.toString() === (subgroupId || groupId).toString());
      
      case 'custom':
        return true; // Anyone can create custom participant lists
      
      default:
        return false;
    }
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
    // FIXED: Use same transition logic as updateEvent method for consistency
    const validTransitions = {
      [EVENT_STATUS.DRAFT]: [EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.PUBLISHED]: [EVENT_STATUS.UPCOMING, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.UPCOMING]: [EVENT_STATUS.STARTED, EVENT_STATUS.ACTIVE, EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.STARTED]: [EVENT_STATUS.ACTIVE, EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.ACTIVE]: [EVENT_STATUS.COMPLETED, EVENT_STATUS.CANCELLED],
      [EVENT_STATUS.COMPLETED]: [EVENT_STATUS.CLOSED],
      [EVENT_STATUS.CANCELLED]: [EVENT_STATUS.CLOSED]
    };

    const allowedTransitions = validTransitions[currentStatus] || [];
    return allowedTransitions.includes(newStatus);
  }

  /**
   * Cancel an event
   */
  async cancelEvent(eventId, reason, cancelledBy, cancelledByRole, ipAddress, notifyParticipants = true) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw ApiError.notFound('Event not found', ERROR_CODES.EVENT_NOT_FOUND);
    }

    // Check permissions
    if (!this.canDeleteEvent(cancelledBy, cancelledByRole, event)) {
      throw ApiError.forbidden('Access denied', ERROR_CODES.ACCESS_DENIED);
    }

    // Validate status transition
    if (!this.isValidStatusTransition(event.status, EVENT_STATUS.CANCELLED)) {
      throw ApiError.badRequest(
        `Cannot cancel event with current status: ${event.status}`,
        ERROR_CODES.INVALID_STATUS_TRANSITION
      );
    }

    // Update event status
    event.status = EVENT_STATUS.CANCELLED;
    event.cancelledAt = new Date();
    event.cancelledBy = cancelledBy;
    event.cancellationReason = reason;

    await event.save();

    // Optional: Implement participant notification logic
    if (notifyParticipants) {
      // TODO: Implement notification service to inform participants
      // This could involve sending emails, SMS, or in-app notifications
    }

    // Log cancellation
    await AuditLog.logAction({
      userId: cancelledBy,
      action: AUDIT_ACTIONS.EVENT_CANCEL,
      resource: 'event',
      resourceId: eventId,
      details: { 
        title: event.title, 
        reason,
        previousStatus: event.status 
      },
      ipAddress,
      result: { success: true }
    });

    return { 
      success: true, 
      message: 'Event cancelled successfully', 
      event 
    };
  }
}

module.exports = new EventService(); 
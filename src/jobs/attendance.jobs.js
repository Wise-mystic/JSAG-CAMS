// Attendance Jobs
// Handles auto-closure, reminders, sync, and late marking

const cron = require('node-cron');
const Attendance = require('../models/Attendance.model');
const Event = require('../models/Event.model');
const User = require('../models/User.model');
const smsService = require('../services/sms.service');
const notificationService = require('../services/notification.service');
const redisConfig = require('../config/redis');
const logger = require('../utils/logger');
const { EVENT_STATUS, ATTENDANCE_STATUS } = require('../utils/constants');

class AttendanceJobs {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
  }

  /**
   * Auto-close events that have exceeded their duration
   * Runs every 30 minutes
   */
  async autoCloseEvents() {
    try {
      logger.info('Starting auto-close events job');
      
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 3); // Events older than 3 hours

      // Find events that should be auto-closed
      const eventsToClose = await Event.find({
        status: EVENT_STATUS.ACTIVE,
        startTime: { $lt: cutoffTime },
        autoClose: true
      }).populate('createdBy', 'firstName lastName phone');

      let closedCount = 0;
      
      for (const event of eventsToClose) {
        try {
          // Update event status
          event.status = EVENT_STATUS.COMPLETED;
          event.endTime = new Date();
          event.autoClosedAt = new Date();
          await event.save();

          // Update all pending attendances to absent
          await Attendance.updateMany(
            { 
              event: event._id, 
              status: ATTENDANCE_STATUS.PENDING 
            },
            { 
              status: ATTENDANCE_STATUS.ABSENT,
              markedAt: new Date(),
              autoMarked: true
            }
          );

          // Send notification to event creator
          if (event.createdBy?.phone) {
            await notificationService.sendEventClosureNotification(
              event.createdBy.phone,
              event.title,
              event._id
            );
          }

          closedCount++;
          logger.info(`Auto-closed event: ${event.title} (${event._id})`);
        } catch (eventError) {
          logger.error(`Failed to auto-close event ${event._id}:`, eventError);
        }
      }

      logger.info(`Auto-close events job completed. Closed ${closedCount} events`);
      return { success: true, closedEvents: closedCount };
      
    } catch (error) {
      logger.error('Auto-close events job failed:', error);
      throw error;
    }
  }

  /**
   * Send attendance reminders for active events
   * Runs every hour during service hours
   */
  async sendReminders() {
    try {
      logger.info('Starting send reminders job');
      
      const now = new Date();
      const reminderWindow = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // 2 hours ahead

      // Find active events that need reminders
      const activeEvents = await Event.find({
        status: EVENT_STATUS.ACTIVE,
        startTime: { 
          $gte: now,
          $lte: reminderWindow 
        },
        sendReminders: true
      }).populate('participants.user', 'firstName lastName phone')
        .populate('createdBy', 'firstName lastName phone');

      let remindersSent = 0;

      for (const event of activeEvents) {
        try {
          // Check if reminder already sent
          const reminderKey = `reminder:${event._id}:${now.toDateString()}`;
          const reminderSent = await redisConfig.get(reminderKey);
          
          if (reminderSent) {
            continue; // Skip if reminder already sent today
          }

          // Send reminders to all participants
          const participants = event.participants || [];
          
          for (const participant of participants) {
            if (participant.user?.phone) {
              try {
                await notificationService.sendAttendanceReminder(
                  participant.user.phone,
                  event.title,
                  event.startTime,
                  event._id
                );
                remindersSent++;
              } catch (smsError) {
                logger.error(`Failed to send reminder to ${participant.user.phone}:`, smsError);
              }
            }
          }

          // Mark reminder as sent
          await redisConfig.setex(reminderKey, 86400, 'sent'); // 24 hours TTL
          
          logger.info(`Sent ${participants.length} reminders for event: ${event.title}`);
          
        } catch (eventError) {
          logger.error(`Failed to process reminders for event ${event._id}:`, eventError);
        }
      }

      logger.info(`Send reminders job completed. Sent ${remindersSent} reminders`);
      return { success: true, remindersSent };
      
    } catch (error) {
      logger.error('Send reminders job failed:', error);
      throw error;
    }
  }

  /**
   * Sync attendance data and update statistics
   * Runs every 6 hours
   */
  async syncAttendance() {
    try {
      logger.info('Starting sync attendance job');
      
      const syncStats = {
        eventsProcessed: 0,
        attendanceRecordsUpdated: 0,
        statisticsUpdated: 0
      };

      // Get all events from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentEvents = await Event.find({
        createdAt: { $gte: thirtyDaysAgo }
      });

      for (const event of recentEvents) {
        try {
          // Update event attendance statistics
          const attendanceStats = await Attendance.aggregate([
            { $match: { event: event._id } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ]);

          const stats = {};
          attendanceStats.forEach(stat => {
            stats[stat._id] = stat.count;
          });

          // Update event with latest stats
          event.attendanceStats = {
            present: stats[ATTENDANCE_STATUS.PRESENT] || 0,
            absent: stats[ATTENDANCE_STATUS.ABSENT] || 0,
            late: stats[ATTENDANCE_STATUS.LATE] || 0,
            pending: stats[ATTENDANCE_STATUS.PENDING] || 0,
            lastUpdated: new Date()
          };

          await event.save();
          syncStats.eventsProcessed++;
          syncStats.statisticsUpdated++;
          
        } catch (eventError) {
          logger.error(`Failed to sync event ${event._id}:`, eventError);
        }
      }

      // Clean up orphaned attendance records
      const orphanedAttendance = await Attendance.aggregate([
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
            eventData: { $size: 0 }
          }
        }
      ]);

      if (orphanedAttendance.length > 0) {
        await Attendance.deleteMany({
          _id: { $in: orphanedAttendance.map(a => a._id) }
        });
        logger.info(`Cleaned up ${orphanedAttendance.length} orphaned attendance records`);
      }

      // Update user attendance streaks
      await this.updateAttendanceStreaks();

      logger.info('Sync attendance job completed:', syncStats);
      return { success: true, stats: syncStats };
      
    } catch (error) {
      logger.error('Sync attendance job failed:', error);
      throw error;
    }
  }

  /**
   * Allow late marking for events (up to 24 hours after event end)
   * Runs every hour
   */
  async allowLateMarking() {
    try {
      logger.info('Starting allow late marking job');
      
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      // Find events that should no longer allow late marking
      const eventsToClose = await Event.find({
        status: EVENT_STATUS.COMPLETED,
        endTime: { $lt: twentyFourHoursAgo },
        allowLateMarking: true
      });

      let updatedCount = 0;

      for (const event of eventsToClose) {
        try {
          // Disable late marking
          event.allowLateMarking = false;
          event.lateMarkingClosedAt = new Date();
          await event.save();

          // Mark all remaining pending attendances as absent
          const result = await Attendance.updateMany(
            { 
              event: event._id, 
              status: ATTENDANCE_STATUS.PENDING 
            },
            { 
              status: ATTENDANCE_STATUS.ABSENT,
              markedAt: new Date(),
              autoMarked: true,
              reason: 'Late marking window expired'
            }
          );

          updatedCount++;
          logger.info(`Closed late marking for event: ${event.title} (${result.modifiedCount} records updated)`);
          
        } catch (eventError) {
          logger.error(`Failed to close late marking for event ${event._id}:`, eventError);
        }
      }

      logger.info(`Allow late marking job completed. Updated ${updatedCount} events`);
      return { success: true, eventsUpdated: updatedCount };
      
    } catch (error) {
      logger.error('Allow late marking job failed:', error);
      throw error;
    }
  }

  /**
   * Update user attendance streaks
   * Helper method for sync job
   */
  async updateAttendanceStreaks() {
    try {
      const users = await User.find({ 
        role: { $ne: 'Super Admin' },
        isActive: true 
      });

      for (const user of users) {
        try {
          // Get user's recent attendance records
          const recentAttendance = await Attendance.find({
            user: user._id,
            markedAt: { 
              $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Last 90 days
            }
          }).sort({ markedAt: -1 }).populate('event', 'startTime');

          // Calculate current streak
          let currentStreak = 0;
          let longestStreak = 0;
          let tempStreak = 0;

          for (const attendance of recentAttendance) {
            if (attendance.status === ATTENDANCE_STATUS.PRESENT || 
                attendance.status === ATTENDANCE_STATUS.LATE) {
              tempStreak++;
              if (currentStreak === 0) currentStreak = tempStreak;
            } else {
              longestStreak = Math.max(longestStreak, tempStreak);
              tempStreak = 0;
              currentStreak = 0;
            }
          }

          longestStreak = Math.max(longestStreak, tempStreak);

          // Update user's attendance stats
          user.attendanceStats = {
            ...user.attendanceStats,
            currentStreak,
            longestStreak,
            lastUpdated: new Date()
          };

          await user.save();
          
        } catch (userError) {
          logger.error(`Failed to update streak for user ${user._id}:`, userError);
        }
      }
      
    } catch (error) {
      logger.error('Update attendance streaks failed:', error);
      throw error;
    }
  }

  /**
   * Start all attendance jobs
   */
  startJobs() {
    if (this.isRunning) {
      logger.warn('Attendance jobs are already running');
      return;
    }

    // Auto-close events every 30 minutes
    const autoCloseJob = cron.schedule('*/30 * * * *', async () => {
      await this.autoCloseEvents();
    }, { scheduled: false });

    // Send reminders every hour during service hours (6 AM - 10 PM)
    const reminderJob = cron.schedule('0 6-22 * * *', async () => {
      await this.sendReminders();
    }, { scheduled: false });

    // Sync attendance every 6 hours
    const syncJob = cron.schedule('0 */6 * * *', async () => {
      await this.syncAttendance();
    }, { scheduled: false });

    // Process late marking every hour
    const lateMarkingJob = cron.schedule('0 * * * *', async () => {
      await this.allowLateMarking();
    }, { scheduled: false });

    // Store jobs for management
    this.jobs.set('autoClose', autoCloseJob);
    this.jobs.set('reminders', reminderJob);
    this.jobs.set('sync', syncJob);
    this.jobs.set('lateMarking', lateMarkingJob);

    // Start all jobs
    autoCloseJob.start();
    reminderJob.start();
    syncJob.start();
    lateMarkingJob.start();

    this.isRunning = true;
    logger.info('Attendance jobs started successfully');
  }

  /**
   * Stop all attendance jobs
   */
  stopJobs() {
    if (!this.isRunning) {
      logger.warn('Attendance jobs are not running');
      return;
    }

    this.jobs.forEach((job, name) => {
      job.destroy();
      logger.info(`Stopped attendance job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    logger.info('All attendance jobs stopped');
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

module.exports = new AttendanceJobs(); 
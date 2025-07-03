const mongoose = require('mongoose');
const { ATTENDANCE_STATUS } = require('../utils/constants');

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: [true, 'Event ID is required'],
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
  },
  
  status: {
    type: String,
    enum: Object.values(ATTENDANCE_STATUS),
    required: [true, 'Attendance status is required'],
    default: ATTENDANCE_STATUS.ABSENT,
  },
  
  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Marker ID is required'],
  },
  
  markedAt: {
    type: Date,
    default: Date.now,
  },
  
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes must not exceed 500 characters'],
  },
  
  arrivalTime: {
    type: Date,
    default: null,
  },
  
  departureTime: {
    type: Date,
    default: null,
  },
  
  isManualEntry: {
    type: Boolean,
    default: false,
  },
  
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
  },
  
  metadata: {
    device: String,
    ipAddress: String,
    userAgent: String,
    appVersion: String,
  },
  
  history: [{
    previousStatus: {
      type: String,
      enum: Object.values(ATTENDANCE_STATUS),
    },
    newStatus: {
      type: String,
      enum: Object.values(ATTENDANCE_STATUS),
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    reason: String,
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound unique index to prevent duplicate attendance records
attendanceSchema.index({ eventId: 1, userId: 1 }, { unique: true });

// Other indexes for performance
attendanceSchema.index({ userId: 1, createdAt: -1 });
attendanceSchema.index({ eventId: 1, status: 1 });
attendanceSchema.index({ markedBy: 1 });
attendanceSchema.index({ markedAt: -1 });

// Pre-save middleware
attendanceSchema.pre('save', async function(next) {
  try {
    // If status is being modified and it's not a new document
    if (this.isModified('status') && !this.isNew) {
      // Add to history
      this.history.push({
        previousStatus: this._original ? this._original.status : this.status,
        newStatus: this.status,
        changedBy: this.markedBy,
        changedAt: new Date(),
      });
    }
    
    // Set arrival time for present/late status
    if ((this.status === ATTENDANCE_STATUS.PRESENT || this.status === ATTENDANCE_STATUS.LATE) && !this.arrivalTime) {
      this.arrivalTime = new Date();
    }
    
    // Validate event exists and is not closed
    const Event = mongoose.model('Event');
    const event = await Event.findById(this.eventId);
    
    if (!event) {
      throw new Error('Event not found');
    }
    
    if (event.isClosed && this.isNew) {
      throw new Error('Cannot mark attendance for a closed event');
    }
    
    // Check if user is expected participant
    if (!event.expectedParticipants.includes(this.userId)) {
      // Check if walk-ins are allowed
      if (!event.settings.allowWalkIns) {
        throw new Error('User is not an expected participant and walk-ins are not allowed');
      }
      
      // Add user to actual participants
      event.actualParticipants.push({
        user: this.userId,
        addedAt: new Date(),
      });
      await event.save();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Post-save middleware to update event statistics
attendanceSchema.post('save', async function(doc) {
  try {
    const Event = mongoose.model('Event');
    const event = await Event.findById(doc.eventId);
    
    if (event && !event.isClosed) {
      // Update event metadata with latest attendance counts
      const attendanceStats = await mongoose.model('Attendance').aggregate([
        { $match: { eventId: doc.eventId } },
        { $group: {
          _id: '$status',
          count: { $sum: 1 }
        }}
      ]);
      
      // Reset counts
      event.metadata.totalAttended = 0;
      event.metadata.totalAbsent = 0;
      event.metadata.totalExcused = 0;
      event.metadata.totalLate = 0;
      
      attendanceStats.forEach(stat => {
        switch (stat._id) {
          case ATTENDANCE_STATUS.PRESENT:
            event.metadata.totalAttended = stat.count;
            break;
          case ATTENDANCE_STATUS.ABSENT:
            event.metadata.totalAbsent = stat.count;
            break;
          case ATTENDANCE_STATUS.EXCUSED:
            event.metadata.totalExcused = stat.count;
            break;
          case ATTENDANCE_STATUS.LATE:
            event.metadata.totalLate = stat.count;
            break;
        }
      });
      
      await event.save();
    }
  } catch (error) {
    console.error('Error updating event statistics:', error);
  }
});

// Instance methods
attendanceSchema.methods = {
  // Update attendance status
  async updateStatus(newStatus, markedBy, reason) {
    this._original = { status: this.status };
    this.status = newStatus;
    this.markedBy = markedBy;
    
    if (reason) {
      this.notes = reason;
    }
    
    await this.save();
  },
  
  // Mark as late
  async markAsLate(arrivalTime, markedBy) {
    this.status = ATTENDANCE_STATUS.LATE;
    this.arrivalTime = arrivalTime || new Date();
    this.markedBy = markedBy;
    await this.save();
  },
  
  // Add note
  async addNote(note, userId) {
    const existingNote = this.notes || '';
    const timestamp = new Date().toISOString();
    this.notes = existingNote + `\n[${timestamp}] ${note}`;
    this.markedBy = userId;
    await this.save();
  },
  
  // Check if attendance can be modified
  canModify(userId) {
    const User = mongoose.model('User');
    const user = User.findById(userId);
    
    // Super admin and senior pastor can always modify
    if (['super-admin', 'senior-pastor'].includes(user.role)) {
      return true;
    }
    
    // Original marker can modify within 1 hour
    if (this.markedBy.equals(userId)) {
      const hoursSinceMarked = (Date.now() - this.markedAt) / (1000 * 60 * 60);
      return hoursSinceMarked <= 1;
    }
    
    return false;
  },
  
  // Convert to safe JSON
  toSafeJSON() {
    const obj = this.toObject();
    delete obj.__v;
    delete obj.metadata.ipAddress; // Remove sensitive data
    return obj;
  },
};

// Static methods
attendanceSchema.statics = {
  // Mark attendance for a user
  async markAttendance(eventId, userId, status, markedBy, options = {}) {
    const { notes, isManualEntry, location, metadata } = options;
    
    try {
      // Check if attendance already exists
      let attendance = await this.findOne({ eventId, userId });
      
      if (attendance) {
        // Update existing attendance
        attendance._original = { status: attendance.status };
        attendance.status = status;
        attendance.markedBy = markedBy;
        attendance.markedAt = new Date();
        
        if (notes) attendance.notes = notes;
        if (location) attendance.location = location;
        if (metadata) attendance.metadata = { ...attendance.metadata, ...metadata };
        
        await attendance.save();
      } else {
        // Create new attendance record
        attendance = await this.create({
          eventId,
          userId,
          status,
          markedBy,
          notes,
          isManualEntry: isManualEntry || false,
          location,
          metadata,
        });
      }
      
      return attendance;
    } catch (error) {
      throw error;
    }
  },
  
  // Bulk mark attendance
  async bulkMarkAttendance(eventId, attendanceData, markedBy) {
    const bulkOps = attendanceData.map(({ userId, status, notes }) => ({
      updateOne: {
        filter: { eventId, userId },
        update: {
          $set: {
            status,
            markedBy,
            markedAt: new Date(),
            notes,
          },
        },
        upsert: true,
      },
    }));
    
    return await this.bulkWrite(bulkOps);
  },
  
  // Get event attendance
  async getEventAttendance(eventId) {
    return await this.find({ eventId })
      .populate('userId', 'fullName phoneNumber email departmentId')
      .populate('markedBy', 'fullName')
      .sort('userId.fullName');
  },
  
  // Get user attendance history
  async getUserAttendanceHistory(userId, dateRange = {}) {
    const query = { userId };
    
    if (dateRange.from || dateRange.to) {
      query.createdAt = {};
      if (dateRange.from) query.createdAt.$gte = dateRange.from;
      if (dateRange.to) query.createdAt.$lte = dateRange.to;
    }
    
    return await this.find(query)
      .populate('eventId', 'title eventType startTime endTime')
      .sort('-createdAt');
  },
  
  // Get attendance statistics
  async getAttendanceStatistics(filter = {}) {
    const pipeline = [
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$count' },
          statusCounts: {
            $push: {
              status: '$_id',
              count: '$count',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          total: 1,
          present: {
            $reduce: {
              input: '$statusCounts',
              initialValue: 0,
              in: {
                $cond: [
                  { $eq: ['$$this.status', ATTENDANCE_STATUS.PRESENT] },
                  '$$this.count',
                  '$$value',
                ],
              },
            },
          },
          absent: {
            $reduce: {
              input: '$statusCounts',
              initialValue: 0,
              in: {
                $cond: [
                  { $eq: ['$$this.status', ATTENDANCE_STATUS.ABSENT] },
                  '$$this.count',
                  '$$value',
                ],
              },
            },
          },
          excused: {
            $reduce: {
              input: '$statusCounts',
              initialValue: 0,
              in: {
                $cond: [
                  { $eq: ['$$this.status', ATTENDANCE_STATUS.EXCUSED] },
                  '$$this.count',
                  '$$value',
                ],
              },
            },
          },
          late: {
            $reduce: {
              input: '$statusCounts',
              initialValue: 0,
              in: {
                $cond: [
                  { $eq: ['$$this.status', ATTENDANCE_STATUS.LATE] },
                  '$$this.count',
                  '$$value',
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          attendanceRate: {
            $cond: [
              { $eq: ['$total', 0] },
              0,
              {
                $multiply: [
                  { $divide: [{ $add: ['$present', '$late'] }, '$total'] },
                  100,
                ],
              },
            ],
          },
        },
      },
    ];
    
    const results = await this.aggregate(pipeline);
    return results[0] || {
      total: 0,
      present: 0,
      absent: 0,
      excused: 0,
      late: 0,
      attendanceRate: 0,
    };
  },
  
  // Mark all unmarked attendances as absent for a closed event
  async markUnmarkedAsAbsent(eventId, markedBy) {
    const Event = mongoose.model('Event');
    const event = await Event.findById(eventId);
    
    if (!event) {
      throw new Error('Event not found');
    }
    
    // Get all expected participants
    const expectedUserIds = event.expectedParticipants;
    
    // Get all marked attendances
    const markedAttendances = await this.find({ eventId }).select('userId');
    const markedUserIds = markedAttendances.map(a => a.userId.toString());
    
    // Find unmarked users
    const unmarkedUserIds = expectedUserIds.filter(
      userId => !markedUserIds.includes(userId.toString())
    );
    
    // Bulk create absent records
    if (unmarkedUserIds.length > 0) {
      const absentRecords = unmarkedUserIds.map(userId => ({
        eventId,
        userId,
        status: ATTENDANCE_STATUS.ABSENT,
        markedBy,
        markedAt: new Date(),
        notes: 'Auto-marked as absent on event closure',
        isManualEntry: false,
      }));
      
      await this.insertMany(absentRecords);
    }
    
    return unmarkedUserIds.length;
  },
};

// Create and export the model
const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance; 
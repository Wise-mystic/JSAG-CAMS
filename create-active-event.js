const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Create active event
async function createActiveEvent() {
  const Event = require('./src/models/Event.model');
  
  // Calculate times to ensure event is ACTIVE
  const now = new Date();
  const startTime = new Date(now.getTime() - (30 * 60 * 1000)); // 30 minutes ago
  const endTime = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // 2 hours from now
  
  const eventData = {
    title: "Test Active Event",
    description: "Automatically created active event for testing attendance",
    eventType: "meeting",
    startTime: startTime,
    endTime: endTime,
    location: {
      name: "Main Hall",
      address: "Church Main Building"
    },
    requiresAttendance: true,
    isPublic: true,
    targetAudience: "all",
    sendReminders: false,
    autoCloseAfterHours: 3
  };
  
  try {
    const event = new Event(eventData);
    const savedEvent = await event.save();
    
    console.log('✅ Active event created successfully!');
    console.log('Event ID:', savedEvent._id);
    console.log('Event Status:', savedEvent.status);
    console.log('Start Time:', savedEvent.startTime);
    console.log('End Time:', savedEvent.endTime);
    console.log('\nYou can now use this event ID for attendance testing:');
    console.log(`Event ID: ${savedEvent._id}`);
    
    return savedEvent;
  } catch (error) {
    console.error('❌ Failed to create event:', error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    await connectDB();
    await createActiveEvent();
    console.log('\n🎉 Done! You can now test attendance marking with the event ID above.');
  } catch (error) {
    console.error('Script failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main(); 
const mongoose = require('mongoose');
const config = require('./src/config/environment');
const Attendance = require('./src/models/Attendance.model');

async function listAttendanceForEvent() {
  try {
    // Connect to database
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log('✅ Connected to database');

    // Get event ID from command line args
    const eventId = process.argv[2];
    
    if (!eventId) {
      console.log('❌ Please provide an event ID');
      console.log('Usage: node list-attendance.js <eventId>');
      process.exit(1);
    }

    console.log(`\n🔍 Finding attendance records for event: ${eventId}\n`);

    // Find all attendance records for the event
    const attendanceRecords = await Attendance.find({ eventId })
      .populate('userId', 'fullName phoneNumber')
      .populate('markedBy', 'fullName')
      .sort('userId.fullName');

    if (attendanceRecords.length === 0) {
      console.log('❌ No attendance records found for this event');
      return;
    }

    console.log(`✅ Found ${attendanceRecords.length} attendance records:\n`);

    attendanceRecords.forEach((record, index) => {
      console.log(`${index + 1}. Attendance Record ID: ${record._id}`);
      console.log(`   User: ${record.userId?.fullName || 'Unknown'} (${record.userId?.phoneNumber || 'No phone'})`);
      console.log(`   Status: ${record.status}`);
      console.log(`   Marked by: ${record.markedBy?.fullName || 'Unknown'}`);
      console.log(`   Marked at: ${record.markedAt}`);
      console.log(`   Notes: ${record.notes || 'None'}`);
      console.log('   ---');
    });

    console.log('\n💡 To update any of these records, use the "Attendance Record ID" in your PUT request');
    console.log('   Example: PUT /api/v1/attendance/{Attendance Record ID}');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

listAttendanceForEvent(); 
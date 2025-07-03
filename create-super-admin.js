// Script to create a super admin user
const mongoose = require('mongoose');
const config = require('./src/config/environment');
const User = require('./src/models/User.model');
const { USER_ROLES } = require('./src/utils/constants');
const AuditLog = require('./src/models/AuditLog.model');
const { AUDIT_ACTIONS } = require('./src/utils/constants');

// Super admin details - you may want to change these
const SUPER_ADMIN = {
  fullName: 'System Administrator',
  phoneNumber: '+233500000000',  // Change to your preferred phone number
  email: 'admin@cams.church',    // Change to your preferred email
  password: 'Admin@123456',      // Change to a secure password
  role: USER_ROLES.SUPER_ADMIN,
  isVerified: true,              // Skip OTP verification
  isActive: true
};

async function createSuperAdmin() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log('Connected to MongoDB successfully!');
    
    // Check if a super admin already exists
    const existingSuperAdmin = await User.findOne({ role: USER_ROLES.SUPER_ADMIN });
    if (existingSuperAdmin) {
      console.log('A super admin already exists:', existingSuperAdmin.fullName);
      console.log('Email:', existingSuperAdmin.email);
      console.log('Phone:', existingSuperAdmin.phoneNumber);
      await mongoose.disconnect();
      return;
    }
    
    // Check if the phone number is already in use
    const existingPhone = await User.findOne({ phoneNumber: SUPER_ADMIN.phoneNumber });
    if (existingPhone) {
      console.error('Phone number is already in use. Please change the phone number in the script.');
      await mongoose.disconnect();
      return;
    }
    
    // Create the super admin
    console.log('Creating super admin user...');
    const superAdmin = new User(SUPER_ADMIN);
    await superAdmin.save();
    
    // Log the action
    await AuditLog.create({
      userId: superAdmin._id,
      action: AUDIT_ACTIONS.USER_REGISTER,
      resource: 'user',
      resourceId: superAdmin._id,
      details: {
        method: 'direct_creation',
        role: USER_ROLES.SUPER_ADMIN
      },
      ipAddress: '127.0.0.1',
      userAgent: 'create-super-admin-script',
      result: { success: true }
    });
    
    console.log('Super admin created successfully!');
    console.log('Full Name:', superAdmin.fullName);
    console.log('Phone Number:', superAdmin.phoneNumber);
    console.log('Email:', superAdmin.email);
    console.log('Role:', superAdmin.role);
    console.log('\nYou can now log in with these credentials.');
    
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    
  } catch (error) {
    console.error('Error creating super admin:', error);
    await mongoose.disconnect();
  }
}

// Execute the function
createSuperAdmin(); 
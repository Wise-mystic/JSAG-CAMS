const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  // Server Configuration
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5001, // Changed from 5000 to 5001
  
  // Database Configuration
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cams_db',
    options: {}  // Empty options object - deprecated options removed
  },
  
  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
  
  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-this',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-this',
    expiresIn: process.env.JWT_EXPIRE || '90m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  },
  
  // SMS Configuration
  sms: {
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || 'CAMS',
    baseUrl: process.env.SMS_BASE_URL || 'https://smsnotifygh.com/api/v1',
  },
  
  // Email Configuration
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'CAMS Church <noreply@cams.church>',
  },
  
  // OTP Configuration
  otp: {
    expireMinutes: parseInt(process.env.OTP_EXPIRE_MINUTES) || 5,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS) || 3,
    resendCooldownMinutes: parseInt(process.env.OTP_RESEND_COOLDOWN_MINUTES) || 2,
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },
  
  // CORS
  cors: {
    origin: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['http://localhost:3000'],
    credentials: true,
  },
  
  // File Upload
  fileUpload: {
    maxSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 10,
    allowedTypes: process.env.ALLOWED_FILE_TYPES 
      ? process.env.ALLOWED_FILE_TYPES.split(',')
      : ['jpg', 'jpeg', 'png', 'pdf', 'csv', 'xlsx'],
  },
  
  // Background Jobs
  jobs: {
    cleanupDays: parseInt(process.env.JOB_CLEANUP_DAYS) || 30,
    autoCloseHours: parseInt(process.env.AUTO_CLOSE_HOURS) || 3,
  },
  
  // System
  system: {
    adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@123',
    systemEmail: process.env.SYSTEM_EMAIL || 'admin@cams.church',
  },
  
  // Security
  security: {
    bcryptRounds: 12,
    tokenBlacklistTTL: 60 * 60 * 24 * 7, // 7 days in seconds
  }
};

// Validate required environment variables in production
if (config.env === 'production') {
  const requiredVars = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MONGODB_URI',
    'SMS_API_KEY',
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

module.exports = config; 
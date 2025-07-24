const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupProduction() {
  console.log('=== CAMS Production Setup ===\n');
  console.log('This will help you configure the system for production SMS notifications.\n');

  // Get SMS API key
  const smsApiKey = await question('Enter your SMSnotifyGh API key: ');
  if (!smsApiKey.trim()) {
    console.log('❌ SMS API key is required for production mode');
    rl.close();
    return;
  }

  // Get sender ID
  const senderId = await question('Enter your SMS sender ID (e.g., CAMS): ') || 'CAMS';

  // Get phone number for testing
  const testPhone = await question('Enter your phone number for testing (e.g., +233244123456): ');
  if (!testPhone.trim()) {
    console.log('❌ Test phone number is required');
    rl.close();
    return;
  }

  // Create .env content
  const envContent = `# Environment Configuration
NODE_ENV=production

# Server Configuration
PORT=5001

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/cams_db

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-key-change-this-in-production
JWT_EXPIRE=90m
JWT_REFRESH_EXPIRE=7d

# SMS Configuration - SMSnotifyGh API
SMS_API_KEY=${smsApiKey}
SMS_SENDER_ID=${senderId}
SMS_BASE_URL=https://smsnotifygh.com/api/v1

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-email-password
EMAIL_FROM=CAMS Church <noreply@cams.church>

# OTP Configuration
OTP_EXPIRE_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RESEND_COOLDOWN_MINUTES=2

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_DIR=logs

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-domain.com

# File Upload
MAX_FILE_SIZE_MB=10
ALLOWED_FILE_TYPES=jpg,jpeg,png,pdf,csv,xlsx

# Background Jobs
JOB_CLEANUP_DAYS=30
AUTO_CLOSE_HOURS=3

# System
ADMIN_DEFAULT_PASSWORD=Admin@123
SYSTEM_EMAIL=admin@cams.church
`;

  // Write .env file
  const envPath = path.join(__dirname, '.env');
  fs.writeFileSync(envPath, envContent);

  console.log('\n✅ Production environment file created successfully!');
  console.log(`📁 File location: ${envPath}`);
  console.log('\n📋 Next steps:');
  console.log('1. Get your SMS API key from https://smsnotifygh.com');
  console.log('2. Replace the SMS_API_KEY in the .env file with your actual key');
  console.log('3. Test the SMS configuration with: node test-sms.js');
  console.log('4. Start the server in production mode: npm start');
  console.log('\n🔧 To test SMS with your phone number:');
  console.log(`   - Update test-sms.js with your phone: ${testPhone}`);
  console.log('   - Run: node test-sms.js');

  rl.close();
}

setupProduction().catch(console.error); 
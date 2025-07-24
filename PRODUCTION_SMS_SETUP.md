# Production SMS Setup Guide

## Overview
This guide will help you configure the CAMS system to send real SMS notifications (OTPs) to mobile phones in production mode.

## Current Status
- The system is currently in development mode
- SMS notifications are being mocked (not actually sent)
- OTPs are generated but not delivered to phones

## Steps to Enable Production SMS

### 1. Create Environment File
Create a `.env` file in the `backend/` directory with the following content:

```env
# Environment Configuration
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
SMS_API_KEY=your-smsnotifygh-api-key-here
SMS_SENDER_ID=CAMS
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
```

### 2. Get SMS API Key
To send real SMS notifications, you need to:

1. **Sign up for SMSnotifyGh** (https://smsnotifygh.com)
2. **Get your API key** from your dashboard
3. **Replace `your-smsnotifygh-api-key-here`** in the `.env` file with your actual API key

### 3. Configure Sender ID
The `SMS_SENDER_ID` should be your registered sender name (e.g., "CAMS", "CHURCH", etc.)

### 4. Test the Setup
After configuring the `.env` file:

1. **Restart the server**:
   ```bash
   cd backend
   npm start
   ```

2. **Test OTP sending**:
   - Try registering a new user with your phone number
   - You should receive a real SMS with the OTP code

### 5. Verify Production Mode
The system will automatically detect production mode when:
- `NODE_ENV=production` is set
- `SMS_API_KEY` is provided
- The SMS service will switch from mock to real SMS sending

## SMS Features Available

### OTP Verification
- Registration OTP
- Login OTP
- Password reset OTP
- Account verification OTP

### Event Notifications
- Event reminders
- Attendance confirmations
- Custom notifications

### Message Format
OTP messages will be sent in this format:
```
Your CAMS verification code is: 123456. This code will expire in 5 minutes.
```

## Troubleshooting

### SMS Not Sending
1. Check if `NODE_ENV=production` is set
2. Verify your SMS API key is correct
3. Check your SMS account balance
4. Review server logs for SMS errors

### OTP Issues
1. Check Redis connection (required for OTP storage)
2. Verify phone number format (should be +233XXXXXXXXX)
3. Check OTP expiration settings

### Logs
SMS activities are logged in:
- `logs/combined.log` - General logs
- `logs/error.log` - Error logs

## Security Notes
- Never commit your `.env` file to version control
- Use strong JWT secrets in production
- Regularly rotate your SMS API keys
- Monitor SMS usage and costs

## Cost Considerations
- SMSnotifyGh charges per SMS sent
- Monitor your account balance regularly
- Set up usage alerts if available

## Next Steps
1. Create the `.env` file with your configuration
2. Get your SMS API key from SMSnotifyGh
3. Test with a real phone number
4. Monitor the logs for successful SMS delivery 
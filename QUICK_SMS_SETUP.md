# Quick SMS Setup for Production

## 🚀 Enable Real SMS Notifications

Your CAMS system is ready for production SMS! Follow these steps to start receiving OTPs on your phone.

## Step 1: Get SMS API Key

1. **Sign up at SMSnotifyGh**: https://smsnotifygh.com
2. **Get your API key** from your dashboard
3. **Note your sender ID** (e.g., "CAMS", "CHURCH")

## Step 2: Configure Environment

### Option A: Use the Setup Script
```bash
cd backend
node setup-production.js
```

### Option B: Manual Setup
Create a `.env` file in the `backend/` directory:

```env
NODE_ENV=production
SMS_API_KEY=your-actual-api-key-here
SMS_SENDER_ID=CAMS
SMS_BASE_URL=https://smsnotifygh.com/api/v1
```

## Step 3: Test SMS Configuration

```bash
# Test with your phone number
TEST_PHONE=+233244123456 node test-sms.js

# Or test general configuration
node test-sms.js
```

## Step 4: Start Production Server

```bash
npm start
```

## Step 5: Test OTP Functionality

1. **Register a new user** with your phone number
2. **Try login** with your phone number
3. **Check your phone** for SMS with OTP codes

## 📱 SMS Features Available

### OTP Notifications
- ✅ User registration verification
- ✅ Login verification  
- ✅ Password reset
- ✅ Account verification

### Event Notifications
- ✅ Event reminders
- ✅ Attendance confirmations
- ✅ Custom notifications

## 🔧 Troubleshooting

### SMS Not Sending?
- Check if `NODE_ENV=production` is set
- Verify your SMS API key is correct
- Check your SMS account balance
- Review logs: `logs/combined.log`

### OTP Issues?
- Ensure Redis is running
- Check phone number format (+233XXXXXXXXX)
- Verify OTP expiration settings

## 💰 Cost Information
- SMSnotifyGh charges per SMS sent
- Monitor your account balance
- Set up usage alerts if available

## 📞 Support
- Check logs in `logs/` directory
- SMS errors in `logs/error.log`
- General logs in `logs/combined.log`

## 🎯 Next Steps
1. ✅ Configure SMS API key
2. ✅ Test with your phone number
3. ✅ Start production server
4. ✅ Test user registration/login
5. ✅ Monitor SMS delivery

Your system is now ready for production SMS notifications! 🎉 
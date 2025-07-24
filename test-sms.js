const smsService = require('./src/config/sms');
const config = require('./src/config/environment');
const logger = require('./src/utils/logger');

async function testSMSConfiguration() {
  console.log('=== SMS Configuration Test ===\n');
  
  // Check environment
  console.log(`Environment: ${config.env}`);
  console.log(`SMS API Key configured: ${!!config.sms.apiKey}`);
  console.log(`SMS Sender ID: ${config.sms.senderId}`);
  console.log(`SMS Base URL: ${config.sms.baseUrl}\n`);
  
  // Check SMS service configuration
  console.log(`SMS Service configured: ${smsService.isConfigured}`);
  console.log(`Mock mode: ${config.env === 'development' || !smsService.isConfigured}\n`);
  
  // Test phone number validation
  const testNumbers = [
    '+233244123456',
    '0244123456',
    '+1234567890',
    'invalid-number'
  ];
  
  console.log('Phone number validation test:');
  testNumbers.forEach(number => {
    const result = smsService.validatePhoneNumber(number);
    console.log(`${number} -> ${result.valid ? 'Valid' : 'Invalid'} ${result.formatted ? `(${result.formatted})` : ''}`);
  });
  console.log('');
  
  // Test SMS balance (if configured)
  if (smsService.isConfigured && config.env === 'production') {
    try {
      console.log('Checking SMS balance...');
      const balance = await smsService.getBalance();
      console.log(`Balance: ${balance.balance} ${balance.currency}${balance.mock ? ' (Mock)' : ''}`);
    } catch (error) {
      console.log(`Balance check failed: ${error.message}`);
    }
    console.log('');
  }
  
  // Test OTP generation
  console.log('OTP generation test:');
  for (let i = 0; i < 3; i++) {
    const otp = smsService.generateOTP();
    console.log(`Generated OTP: ${otp}`);
  }
  console.log('');
  
  // Test SMS sending (if configured)
  if (smsService.isConfigured && config.env === 'production') {
    // Get test phone from environment or use default
    const testPhone = process.env.TEST_PHONE || '+233244123456'; // Replace with your test number
    const testMessage = 'This is a test SMS from CAMS system.';
    
    console.log(`Testing SMS sending to ${testPhone}...`);
    console.log(`Message: ${testMessage}`);
    console.log('💡 To test with your phone, set TEST_PHONE environment variable');
    
    try {
      const result = await smsService.sendSMS(testPhone, testMessage);
      console.log('✅ SMS sent successfully!');
      console.log(`Message ID: ${result.messageId}`);
      console.log(`Status: ${result.status}`);
      console.log(`Cost: ${result.cost} ${result.currency || 'GHS'}`);
    } catch (error) {
      console.log(`❌ SMS sending failed: ${error.message}`);
    }
  } else {
    console.log('⚠️  SMS sending test skipped (not in production mode or not configured)');
    console.log('   Set NODE_ENV=production and SMS_API_KEY to enable real SMS');
  }
  
  console.log('\n=== Test Complete ===');
}

// Run the test
testSMSConfiguration().catch(console.error); 
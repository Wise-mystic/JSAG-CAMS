const axios = require('axios');
const config = require('./environment');
const logger = require('../utils/logger');

// SMS Service configuration
class SMSService {
  constructor() {
    this.apiKey = config.sms.apiKey;
    this.senderId = config.sms.senderId;
    this.baseUrl = config.sms.baseUrl;
    this.isConfigured = !!this.apiKey;
    
    if (!this.isConfigured) {
      logger.warn('SMS Service: API key not configured. SMS functionality will be disabled.');
    }
  }
  
  // Validate phone number format
  validatePhoneNumber(phoneNumber) {
    // Remove spaces and special characters
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // Check if it's a valid international format
    const internationalRegex = /^\+\d{10,15}$/;
    
    // Check if it's a valid local format (Ghana)
    const localRegex = /^0\d{9}$/;
    
    if (internationalRegex.test(cleaned)) {
      return { valid: true, formatted: cleaned };
    }
    
    if (localRegex.test(cleaned)) {
      // Convert local to international format (Ghana +233)
      return { valid: true, formatted: `+233${cleaned.substring(1)}` };
    }
    
    return { valid: false, formatted: null };
  }
  
  // Send SMS
  async sendSMS(phoneNumber, message) {
    try {
      // Validate phone number
      const { valid, formatted } = this.validatePhoneNumber(phoneNumber);
      if (!valid) {
        throw new Error('Invalid phone number format');
      }
      
      // Always use mock in development or if not configured
      if (config.env === 'development' || !this.isConfigured) {
        logger.warn(`SMS Service: Would send to ${formatted}: ${message}`);
        return {
          success: true,
          messageId: `mock-${Date.now()}`,
          mock: true,
          status: 'sent',
          cost: 0.0
        };
      }
      
      // Prepare request data
      const requestData = {
        api_key: this.apiKey,
        sender_id: this.senderId,
        phone: formatted,
        message: message,
      };
      
      // Send SMS via SMSnotifyGh API
      const response = await axios.post(`${this.baseUrl}/send`, requestData, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 seconds timeout
      });
      
      // Log successful send
      logger.info('SMS sent successfully', {
        phone: formatted,
        messageId: response.data.message_id || `mock-${Date.now()}`,
        status: response.data.status || 'sent',
      });
      
      return {
        success: true,
        messageId: response.data.message_id || `mock-${Date.now()}`,
        status: response.data.status || 'sent',
        cost: response.data.cost || 0.0
      };
      
    } catch (error) {
      logger.error('SMS send failed', {
        phone: phoneNumber,
        error: error.message,
        response: error.response?.data,
      });
      
      throw new Error(`Failed to send SMS: ${error.message}`);
    }
  }
  
  // Send bulk SMS
  async sendBulkSMS(phoneNumbers, message) {
    try {
      // Validate all phone numbers
      const validatedNumbers = phoneNumbers.map(phone => {
        const { valid, formatted } = this.validatePhoneNumber(phone);
        return valid ? formatted : null;
      }).filter(Boolean);
      
      if (validatedNumbers.length === 0) {
        throw new Error('No valid phone numbers provided');
      }
      
      // Always use mock in development or if not configured
      if (config.env === 'development' || !this.isConfigured) {
        logger.warn(`SMS Service: Would send bulk SMS to ${validatedNumbers.length} recipients`);
        return {
          success: true,
          sent: validatedNumbers.length,
          failed: phoneNumbers.length - validatedNumbers.length,
          mock: true,
          details: {
            messageId: `mock-bulk-${Date.now()}`,
            status: 'sent'
          }
        };
      }
      
      // Prepare request data
      const requestData = {
        api_key: this.apiKey,
        sender_id: this.senderId,
        phones: validatedNumbers.join(','),
        message: message,
      };
      
      // Send bulk SMS
      const response = await axios.post(`${this.baseUrl}/send-bulk`, requestData, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 seconds timeout for bulk
      });
      
      logger.info('Bulk SMS sent successfully', {
        totalRecipients: validatedNumbers.length,
        status: response.data.status || 'sent',
      });
      
      return {
        success: true,
        sent: response.data.sent_count || validatedNumbers.length,
        failed: response.data.failed_count || 0,
        details: response.data.details || {
          messageId: `mock-bulk-${Date.now()}`,
          status: 'sent'
        },
      };
      
    } catch (error) {
      logger.error('Bulk SMS send failed', {
        recipientCount: phoneNumbers.length,
        error: error.message,
      });
      
      throw new Error(`Failed to send bulk SMS: ${error.message}`);
    }
  }
  
  // Check SMS delivery status
  async checkDeliveryStatus(messageId) {
    try {
      // Always use mock in development or if not configured
      if (config.env === 'development' || !this.isConfigured || messageId.startsWith('mock-')) {
        return {
          messageId: messageId,
          status: 'delivered',
          deliveredAt: new Date().toISOString(),
          mock: true
        };
      }
      
      const response = await axios.get(`${this.baseUrl}/status/${messageId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 5000,
      });
      
      return {
        messageId: messageId,
        status: response.data.status || 'delivered',
        deliveredAt: response.data.delivered_at || new Date().toISOString(),
      };
      
    } catch (error) {
      logger.error('SMS status check failed', {
        messageId: messageId,
        error: error.message,
      });
      
      throw new Error(`Failed to check SMS status: ${error.message}`);
    }
  }
  
  // Get SMS balance
  async getBalance() {
    try {
      // Always use mock in development or if not configured
      if (config.env === 'development' || !this.isConfigured) {
        return {
          balance: 1000,
          currency: 'GHS',
          mock: true
        };
      }
      
      const response = await axios.get(`${this.baseUrl}/balance`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 5000,
      });
      
      return {
        balance: response.data.balance || 1000,
        currency: response.data.currency || 'GHS',
      };
      
    } catch (error) {
      logger.error('SMS balance check failed', {
        error: error.message,
      });
      
      throw new Error(`Failed to check SMS balance: ${error.message}`);
    }
  }
  
  // Generate OTP
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }
  
  // Send OTP
  async sendOTP(phoneNumber) {
    const otp = this.generateOTP();
    const message = `Your CAMS verification code is: ${otp}. This code will expire in ${config.otp.expireMinutes} minutes.`;
    
    try {
      const result = await this.sendSMS(phoneNumber, message);
      return {
        success: result.success,
        otp: otp, // In production, don't return OTP in response
        messageId: result.messageId,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Send event reminder
  async sendEventReminder(phoneNumber, eventTitle, eventTime) {
    const message = `Reminder: ${eventTitle} is scheduled for ${eventTime}. We look forward to seeing you!`;
    return await this.sendSMS(phoneNumber, message);
  }
  
  // Send attendance confirmation
  async sendAttendanceConfirmation(phoneNumber, eventTitle) {
    const message = `Thank you for attending ${eventTitle}. Your attendance has been recorded. God bless!`;
    return await this.sendSMS(phoneNumber, message);
  }
  
  // Send custom notification
  async sendNotification(phoneNumber, message) {
    return await this.sendSMS(phoneNumber, message);
  }
}

// Create and export singleton instance
const smsService = new SMSService();

module.exports = smsService; 
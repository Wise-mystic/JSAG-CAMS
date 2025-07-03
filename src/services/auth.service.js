const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const config = require('../config/environment');
const smsService = require('../config/sms');
const { otpOperations, sessionOperations, cache } = require('../config/redis');
const { ApiError } = require('../middleware/error.middleware');
const { 
  ERROR_CODES, 
  SUCCESS_MESSAGES, 
  AUDIT_ACTIONS,
  USER_ROLES 
} = require('../utils/constants');

class AuthService {
  // Generate JWT tokens
  generateTokens(userId, role) {
    const payload = { userId, role };
    
    const accessToken = jwt.sign(
      payload,
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    const refreshToken = jwt.sign(
      payload,
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );
    
    return { accessToken, refreshToken };
  }
  
  // Verify JWT token
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.jwt.secret);
    } catch (error) {
      throw error;
    }
  }
  
  // Verify refresh token
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, config.jwt.refreshSecret);
    } catch (error) {
      throw error;
    }
  }
  
  // Register new user
  async register(userData, ipAddress, userAgent) {
    const { fullName, phoneNumber, email, password } = userData;
    
    try {
      // Check if user already exists
      const existingUser = await User.findByPhoneNumber(phoneNumber);
      if (existingUser) {
        throw ApiError.conflict('Phone number already registered', ERROR_CODES.DUPLICATE_ENTRY);
      }
      
      // Check if email is already in use (if provided)
      if (email) {
        const emailExists = await User.findOne({ email });
        if (emailExists) {
          throw ApiError.conflict('Email already registered', ERROR_CODES.DUPLICATE_ENTRY);
        }
      }
      
      // Create new user
      const user = new User({
        fullName,
        phoneNumber,
        email,
        password,
        role: USER_ROLES.MEMBER, // Default role
        isActive: true,
        isVerified: false, // Will be verified after OTP
      });
      
      await user.save();
      
      // Generate and send OTP
      const { otp } = await smsService.sendOTP(phoneNumber);
      
      // Store OTP in Redis
      await otpOperations.storeOTP(phoneNumber, otp);
      
      // Log registration
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_REGISTER,
        resource: 'user',
        resourceId: user._id,
        details: {
          phoneNumber,
          fullName,
          registrationMethod: 'phone',
        },
        ipAddress,
        userAgent,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.REGISTRATION_SUCCESS,
        userId: user._id,
        otpSent: true,
      };
    } catch (error) {
      // Log failed registration attempt
      await AuditLog.logAction({
        userId: null,
        action: AUDIT_ACTIONS.USER_REGISTER,
        resource: 'user',
        details: { phoneNumber, error: error.message },
        ipAddress,
        userAgent,
        result: { success: false, error: { message: error.message } },
      });
      
      throw error;
    }
  }
  
  // Verify OTP
  async verifyOTP(phoneNumber, otp, ipAddress) {
    try {
      // Check OTP cooldown
      const inCooldown = await otpOperations.checkCooldown(phoneNumber);
      if (inCooldown) {
        throw ApiError.tooManyRequests('Please wait before requesting another OTP');
      }
      
      // Verify OTP
      const result = await otpOperations.verifyOTP(phoneNumber, otp);
      
      if (!result.valid) {
        if (result.reason === 'expired') {
          throw ApiError.badRequest('OTP has expired', ERROR_CODES.OTP_EXPIRED);
        } else if (result.reason === 'max_attempts') {
          // Set cooldown
          await otpOperations.setCooldown(phoneNumber);
          throw ApiError.badRequest('Maximum OTP attempts exceeded', ERROR_CODES.OTP_MAX_ATTEMPTS);
        } else {
          throw ApiError.badRequest(
            `Invalid OTP. ${result.attemptsLeft} attempts remaining`,
            ERROR_CODES.OTP_INVALID
          );
        }
      }
      
      // Mark user as verified
      const user = await User.findOneAndUpdate(
        { phoneNumber },
        { isVerified: true },
        { new: true }
      );
      
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id, user.role);
      
      // Store refresh token in Redis
      await sessionOperations.storeRefreshToken(user._id, refreshToken);
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
      // Log successful verification
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'otp_verification' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.OTP_VERIFIED,
        accessToken,
        refreshToken,
        user: user.toSafeJSON(),
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Login with phone and password
  async login(phoneNumber, password, ipAddress, userAgent) {
    try {
      // Find user with password field
      const user = await User.findOne({ phoneNumber }).select('+password');
      
      if (!user) {
        throw ApiError.unauthorized('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
      }
      
      // Check if user is active
      if (!user.isActive) {
        throw ApiError.forbidden('Account is inactive', ERROR_CODES.ACCOUNT_INACTIVE);
      }
      
      // Check if user is verified
      if (!user.isVerified) {
        // Send new OTP
        const { otp } = await smsService.sendOTP(phoneNumber);
        await otpOperations.storeOTP(phoneNumber, otp);
        
        throw ApiError.forbidden(
          'Account not verified. OTP sent to your phone number',
          ERROR_CODES.ACCOUNT_INACTIVE
        );
      }
      
      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        // Log failed login attempt
        await AuditLog.logAction({
          userId: user._id,
          action: AUDIT_ACTIONS.USER_LOGIN,
          resource: 'user',
          resourceId: user._id,
          details: { reason: 'invalid_password' },
          ipAddress,
          userAgent,
          result: { success: false },
        });
        
        throw ApiError.unauthorized('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
      }
      
      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id, user.role);
      
      // Store refresh token in Redis
      await sessionOperations.storeRefreshToken(user._id, refreshToken);
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
      // Log successful login
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'password' },
        ipAddress,
        userAgent,
        result: { success: true },
      });
      
      // Remove password from response
      const userObj = user.toObject();
      delete userObj.password;
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
        accessToken,
        refreshToken,
        user: userObj,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Refresh access token
  async refreshToken(refreshToken, ipAddress) {
    try {
      // Verify refresh token
      const decoded = this.verifyRefreshToken(refreshToken);
      
      // Check if refresh token exists in Redis
      const isValid = await sessionOperations.validateRefreshToken(decoded.userId, refreshToken);
      if (!isValid) {
        throw ApiError.unauthorized('Invalid refresh token', ERROR_CODES.TOKEN_INVALID);
      }
      
      // Get user
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        throw ApiError.unauthorized('User not found or inactive', ERROR_CODES.ACCOUNT_INACTIVE);
      }
      
      // Generate new tokens
      const tokens = this.generateTokens(user._id, user.role);
      
      // Revoke old refresh token
      await sessionOperations.revokeRefreshToken(decoded.userId, refreshToken);
      
      // Store new refresh token
      await sessionOperations.storeRefreshToken(user._id, tokens.refreshToken);
      
      return {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Logout
  async logout(userId, accessToken, refreshToken, ipAddress) {
    try {
      // Blacklist access token
      const decoded = this.verifyAccessToken(accessToken);
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      await sessionOperations.blacklistToken(accessToken, expiresIn);
      
      // Revoke refresh token
      if (refreshToken) {
        await sessionOperations.revokeRefreshToken(userId, refreshToken);
      }
      
      // Log logout
      await AuditLog.logAction({
        userId,
        action: AUDIT_ACTIONS.USER_LOGOUT,
        resource: 'user',
        resourceId: userId,
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Request password reset
  async requestPasswordReset(phoneNumber, ipAddress) {
    try {
      const user = await User.findOne({ phoneNumber });
      if (!user) {
        // Don't reveal if user exists
        return {
          success: true,
          message: 'If the phone number is registered, you will receive an OTP',
        };
      }
      
      // Check OTP cooldown
      const inCooldown = await otpOperations.checkCooldown(phoneNumber);
      if (inCooldown) {
        throw ApiError.tooManyRequests('Please wait before requesting another OTP');
      }
      
      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      console.log(`Generated session token: ${sessionToken.substring(0, 8)}...`);
      
      // Generate and send OTP
      const { otp } = await smsService.sendOTP(phoneNumber);
      
      // Store OTP in Redis
      await otpOperations.storeOTP(phoneNumber, otp);
      
      // Store session data in Redis
      const sessionKey = `pwreset:session:${sessionToken}`;
      const sessionData = { phoneNumber, userId: user._id.toString() };
      console.log(`Creating password reset session: ${sessionKey}`, sessionData);
      
      const result = await cache.set(sessionKey, sessionData, 600); // 10 minutes expiry
      console.log(`Session creation result: ${result}`);
      
      // Verify session was created
      const storedSession = await cache.get(sessionKey);
      console.log('Stored session data:', storedSession);
      
      // Log password reset request
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { step: 'request_reset' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: 'OTP sent to your phone number',
        sessionToken
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Verify OTP for password reset with session token
  async verifyOTPWithSession(sessionToken, otp, ipAddress) {
    try {
      // Get phone number from session
      const sessionKey = `pwreset:session:${sessionToken}`;
      console.log(`Looking for session with key for verification: ${sessionKey}`);
      
      const sessionData = await cache.get(sessionKey);
      console.log('Session data for verification:', sessionData);
      
      if (!sessionData || !sessionData.phoneNumber) {
        console.log('Session data missing or invalid during verification');
        throw ApiError.badRequest('Invalid or expired session', ERROR_CODES.TOKEN_EXPIRED);
      }
      
      const { phoneNumber, userId } = sessionData;
      
      // Verify OTP
      const result = await otpOperations.verifyOTP(phoneNumber, otp);
      if (!result.valid) {
        if (result.reason === 'expired') {
          throw ApiError.badRequest('OTP has expired', ERROR_CODES.OTP_EXPIRED);
        } else if (result.reason === 'max_attempts') {
          // Set cooldown
          await otpOperations.setCooldown(phoneNumber);
          throw ApiError.badRequest('Maximum OTP attempts exceeded', ERROR_CODES.OTP_MAX_ATTEMPTS);
        } else {
          throw ApiError.badRequest(
            `Invalid OTP. ${result.attemptsLeft} attempts remaining`,
            ERROR_CODES.OTP_INVALID
          );
        }
      }
      
      // Find user
      const user = await User.findById(userId);
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      // Update session to mark OTP as verified
      sessionData.otpVerified = true;
      console.log('Updating session with verification status:', sessionData);
      await cache.set(sessionKey, sessionData, 600); // refresh TTL
      
      // Double-check that verification was saved
      const updatedSession = await cache.get(sessionKey);
      console.log('Verification saved status:', updatedSession);
      
      // Log password reset verification
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { step: 'otp_verified' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: 'OTP verified successfully. You can now reset your password.',
        sessionToken
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Complete password reset with session token
  async completePasswordReset(sessionToken, newPassword, ipAddress) {
    try {
      // Test Redis connection first
      console.log('Testing Redis connection before password reset...');
      const testKey = `test:${Date.now()}`;
      await cache.set(testKey, 'test-value', 60);
      const testValue = await cache.get(testKey);
      console.log('Redis test result:', testValue);
      
      // Debug the exact session token being used
      console.log('Complete password reset for session token:', 
                 sessionToken ? sessionToken.substring(0, 8) + '...' : 'undefined');
                 
      // Get session data from Redis
      const sessionKey = `pwreset:session:${sessionToken}`;
      console.log(`Looking for session with key: ${sessionKey}`);
      
      // Try to verify if session was created during OTP verification
      try {
        // Get all keys in Redis with pattern matching
        const { getRedisClient } = require('../config/redis');
        const client = getRedisClient();
        
        if (!client) {
          console.error('Redis client not available');
          throw new Error('Redis connection error');
        }
        
        console.log('Redis client state:', client.isOpen ? 'Connected' : 'Not connected');
        
        // Try to find matching keys
        const keys = await client.keys('pwreset:session:*');
        console.log('Found session keys:', keys);
        
        // If we find the exact key, check its value directly with client
        if (keys.includes(sessionKey)) {
          console.log('Found matching session key!');
          const directValue = await client.get(sessionKey);
          console.log('Direct session value:', directValue);
          
          if (directValue) {
            // Parse it manually if needed
            try {
              const parsedData = JSON.parse(directValue);
              console.log('Parsed session data:', parsedData);
              
              // Use this data directly if needed
              if (parsedData.phoneNumber && parsedData.userId && parsedData.otpVerified) {
                console.log('Using directly retrieved session data');
                
                // Find user and update password
                const user = await User.findById(parsedData.userId);
                if (!user) {
                  throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
                }
                
                user.password = newPassword;
                user.metadata.passwordChangedAt = Date.now();
                await user.save();
                
                // Delete the session
                await client.del(sessionKey);
                
                // Log password change
                await AuditLog.logAction({
                  userId: user._id,
                  action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
                  resource: 'user',
                  resourceId: user._id,
                  details: { method: 'session_reset' },
                  ipAddress,
                  result: { success: true },
                });
                
                return {
                  success: true,
                  message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
                };
              }
            } catch (parseError) {
              console.error('Error parsing session data:', parseError);
            }
          }
        } else {
          // If not found, this might help debugging
          console.log('Session key not found in Redis. Available keys:', keys);
          
          // We could also try to find a key that has the beginning part of our session token
          const potentialMatches = keys.filter(k => 
            k.includes(sessionToken.substring(0, 16))
          );
          
          if (potentialMatches.length > 0) {
            console.log('Found potential matching keys:', potentialMatches);
          }
        }
      } catch (redisError) {
        console.error('Error accessing Redis keys:', redisError);
      }
      
      // Get session data using cache helper (original approach)
      const sessionData = await cache.get(sessionKey);
      console.log('Session data retrieved:', sessionData);
      
      if (!sessionData || !sessionData.phoneNumber) {
        console.log('Session data missing or invalid');
        throw ApiError.badRequest('Invalid or expired session', ERROR_CODES.TOKEN_EXPIRED);
      }
      
      if (!sessionData.otpVerified) {
        console.log('OTP not verified for this session');
        throw ApiError.badRequest('OTP verification required before password reset', ERROR_CODES.UNAUTHORIZED);
      }
      
      // Find user and update password
      const user = await User.findById(sessionData.userId);
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      user.password = newPassword;
      user.metadata.passwordChangedAt = Date.now();
      await user.save();
      
      // Delete the session
      await cache.del(sessionKey);
      
      // Log password change
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'session_reset' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Verify OTP for password reset and store verification in Redis
  async verifyPasswordResetOTP(phoneNumber, otp, ipAddress) {
    try {
      // Verify OTP
      const otpResult = await otpOperations.verifyOTP(phoneNumber, otp);
      if (!otpResult.valid) {
        if (otpResult.reason === 'expired') {
          throw ApiError.badRequest('OTP has expired', ERROR_CODES.OTP_EXPIRED);
        } else if (otpResult.reason === 'max_attempts') {
          // Set cooldown
          await otpOperations.setCooldown(phoneNumber);
          throw ApiError.badRequest('Maximum OTP attempts exceeded', ERROR_CODES.OTP_MAX_ATTEMPTS);
        } else {
          throw ApiError.badRequest(
            `Invalid OTP. ${otpResult.attemptsLeft} attempts remaining`,
            ERROR_CODES.OTP_INVALID
          );
        }
      }
      
      // Find user
      const user = await User.findOne({ phoneNumber });
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      // Generate a reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      
      // Store reset token in Redis with user's phone number
      const key = `pwreset:${resetToken}`;
      await cache.set(key, { phoneNumber, userId: user._id.toString() }, 600); // 10 minutes expiry
      
      // Log password reset verification
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { step: 'otp_verified' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: 'OTP verified successfully. You can now reset your password.',
        resetToken
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Reset password with reset token
  async completePasswordReset(resetToken, newPassword, ipAddress) {
    try {
      // Get stored phone number from Redis
      const key = `pwreset:${resetToken}`;
      const data = await cache.get(key);
      
      if (!data || !data.phoneNumber || !data.userId) {
        throw ApiError.badRequest('Invalid or expired password reset session', ERROR_CODES.TOKEN_EXPIRED);
      }
      
      // Find user and update password
      const user = await User.findById(data.userId);
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      user.password = newPassword;
      user.metadata.passwordChangedAt = Date.now();
      await user.save();
      
      // Delete the reset token from Redis
      await cache.del(key);
      
      // Log password change
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'token_reset' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Original reset password method (kept for backward compatibility)
  async resetPassword(phoneNumber, otp, newPassword, ipAddress) {
    try {
      // Verify OTP
      const otpResult = await otpOperations.verifyOTP(phoneNumber, otp);
      if (!otpResult.valid) {
        throw ApiError.badRequest('Invalid or expired OTP', ERROR_CODES.OTP_INVALID);
      }
      
      // Find user and update password
      const user = await User.findOne({ phoneNumber });
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      user.password = newPassword;
      user.metadata.passwordChangedAt = Date.now();
      await user.save();
      
      // Log password change
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'otp_reset' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Change password (authenticated)
  async changePassword(userId, currentPassword, newPassword, ipAddress) {
    try {
      const user = await User.findById(userId).select('+password');
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      // Verify current password
      const isValid = await user.comparePassword(currentPassword);
      if (!isValid) {
        throw ApiError.unauthorized('Current password is incorrect', ERROR_CODES.INVALID_CREDENTIALS);
      }
      
      // Update password
      user.password = newPassword;
      user.metadata.passwordChangedAt = Date.now();
      await user.save();
      
      // Log password change
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'authenticated_change' },
        ipAddress,
        result: { success: true },
      });
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Resend OTP
  async resendOTP(phoneNumber, ipAddress) {
    try {
      // Check cooldown
      const inCooldown = await otpOperations.checkCooldown(phoneNumber);
      if (inCooldown) {
        throw ApiError.tooManyRequests('Please wait before requesting another OTP');
      }
      
      const user = await User.findOne({ phoneNumber });
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      // Generate and send new OTP
      const { otp } = await smsService.sendOTP(phoneNumber);
      await otpOperations.storeOTP(phoneNumber, otp);
      await otpOperations.setCooldown(phoneNumber);
      
      return {
        success: true,
        message: SUCCESS_MESSAGES.OTP_SENT,
      };
    } catch (error) {
      throw error;
    }
  }
  
  // Get current user
  async getCurrentUser(userId) {
    try {
      const user = await User.findById(userId)
        .populate('departmentId', 'name')
        .populate('ministryId', 'name')
        .populate('prayerTribes', 'name dayOfWeek')
        .select('-metadata.resetPasswordToken -metadata.resetPasswordExpires');
      
      if (!user) {
        throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
      }
      
      return {
        success: true,
        user: user.toSafeJSON(),
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = AuthService; 
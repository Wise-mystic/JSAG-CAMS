// Authentication Controller
// Handles registration, OTP, login, token refresh, logout, password reset, and profile endpoints

const AuthService = require('../services/auth.service');
const { validateInput } = require('../middleware/validation.middleware');
const { ApiError } = require('../middleware/error.middleware');
const { logger, authLogger } = require('../utils/logger');

class AuthController {
  constructor() {
    // Create auth service instance
    this.authService = new AuthService();

    // Bind all methods to this instance
    this.register = this.register.bind(this);
    this.verifyOtp = this.verifyOtp.bind(this);
    this.login = this.login.bind(this);
    this.refreshToken = this.refreshToken.bind(this);
    this.logout = this.logout.bind(this);
    this.forgotPassword = this.forgotPassword.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
    this.changePassword = this.changePassword.bind(this);
    this.resendOtp = this.resendOtp.bind(this);
    this.getMe = this.getMe.bind(this);
    this.verifySession = this.verifySession.bind(this);
    this.getSecurityLog = this.getSecurityLog.bind(this);
    this.revokeAllSessions = this.revokeAllSessions.bind(this);
    this.verifyPasswordResetOtp = this.verifyPasswordResetOtp.bind(this);
    this.completePasswordReset = this.completePasswordReset.bind(this);
    this.verifyPasswordResetWithSession = this.verifyPasswordResetWithSession.bind(this);
    this.completeSessionPasswordReset = this.completeSessionPasswordReset.bind(this);
  }

  // POST /api/v1/auth/register
  async register(req, res, next) {
    try {
      const { fullName, phoneNumber, email, password } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      const result = await this.authService.register(
        { fullName, phoneNumber, email, password },
        ipAddress,
        userAgent
      );

      res.status(201).json({
        success: true,
        message: result.message,
        data: {
          userId: result.userId,
          otpSent: result.otpSent
        }
      });
    } catch (error) {
      authLogger.error('Registration failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/verify-otp
  async verifyOtp(req, res, next) {
    try {
      const { phoneNumber, otp } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.verifyOTP(phoneNumber, otp, ipAddress);

      // Set refresh token in cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      authLogger.error('OTP verification failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/login
  async login(req, res, next) {
    try {
      const { phoneNumber, password } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      const result = await this.authService.login(phoneNumber, password, ipAddress, userAgent);

      // Set refresh token in cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      authLogger.info('User login successful', {
        userId: result.user.id,
        phoneNumber
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      authLogger.error('Login failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/refresh-token
  async refreshToken(req, res, next) {
    try {
      const refreshToken = req.body.refreshToken || req.cookies.refreshToken;
      
      if (!refreshToken) {
        throw ApiError.unauthorized('Refresh token required');
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const result = await this.authService.refreshToken(refreshToken, ipAddress);

      // Set new refresh token in cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      authLogger.error('Token refresh failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/logout
  async logout(req, res, next) {
    try {
      const userId = req.user.id;
      const accessToken = req.token;
      const refreshToken = req.body.refreshToken || req.cookies.refreshToken;

      await this.authService.logout(userId, accessToken, refreshToken, req.ip);

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      authLogger.info('User logout successful', {
        userId
      });

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      authLogger.error('Logout failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/forgot-password
  async forgotPassword(req, res, next) {
    try {
      const { phoneNumber } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      // Test Redis directly
      const { cache } = require('../config/redis');
      try {
        await cache.set('test-key', 'test-value', 60);
        const testValue = await cache.get('test-key');
        console.log('Redis test result:', testValue);
      } catch (redisError) {
        console.error('Redis test failed:', redisError);
      }

      const result = await this.authService.requestPasswordReset(phoneNumber, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          sessionToken: result.sessionToken
        }
      });
    } catch (error) {
      authLogger.error('Password reset request failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/change-password
  async changePassword(req, res, next) {
    try {
      const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.changePassword(
          userId, 
          currentPassword, 
          newPassword, 
          ipAddress
        );

        res.status(200).json({
          success: true,
          message: result.message
        });
    } catch (error) {
      authLogger.error('Password change failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/verify-password-reset-otp
  async verifyPasswordResetOtp(req, res, next) {
    try {
      const { phoneNumber, otp } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.verifyPasswordResetOTP(phoneNumber, otp, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          resetToken: result.resetToken
        }
      });
    } catch (error) {
      authLogger.error('Password reset OTP verification failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/complete-password-reset
  async completePasswordReset(req, res, next) {
    try {
      const { resetToken, newPassword } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.completePasswordReset(resetToken, newPassword, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      authLogger.error('Complete password reset failed', {
        error: error.message
      });
      next(error);
    }
  }

  // POST /api/v1/auth/reset-password
  async resetPassword(req, res, next) {
    try {
        const { phoneNumber, otp, newPassword } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.resetPassword(
          phoneNumber, 
          otp, 
          newPassword, 
          ipAddress
        );

        res.status(200).json({
          success: true,
          message: result.message
        });
    } catch (error) {
      authLogger.error('Password reset failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // POST /api/v1/auth/resend-otp
  async resendOtp(req, res, next) {
    try {
      const { phoneNumber } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.resendOTP(phoneNumber, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          otpSent: result.otpSent
        }
      });
    } catch (error) {
      authLogger.error('OTP resend failed', {
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });
      next(error);
    }
  }

  // GET /api/v1/auth/me  
  async getMe(req, res, next) {
    try {
      const userId = req.user.id;
      const user = await this.authService.getCurrentUser(userId);

      res.status(200).json({
        success: true,
        data: {
          user
        }
      });
    } catch (error) {
      authLogger.error('Get current user failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/verify-session
  async verifySession(req, res, next) {
    try {
      const userId = req.user.id;
      const token = req.token;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.verifySession(userId, token, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          isValid: result.isValid
        }
      });
    } catch (error) {
      authLogger.error('Session verification failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // GET /api/v1/auth/security-log
  async getSecurityLog(req, res, next) {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      const result = await this.authService.getSecurityLog(userId, page, limit);

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      authLogger.error('Get security log failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/revoke-all-sessions
  async revokeAllSessions(req, res, next) {
    try {
      const userId = req.user.id;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.revokeAllSessions(userId, ipAddress);

      // Clear refresh token cookie
      res.clearCookie('refreshToken');

      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      authLogger.error('Revoke all sessions failed', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // POST /api/v1/auth/verify-password-reset-with-session
  async verifyPasswordResetWithSession(req, res, next) {
    try {
      const { sessionToken, otp } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      const result = await this.authService.verifyOTPWithSession(
        sessionToken,
        otp,
        ipAddress
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          sessionToken: result.sessionToken
        }
      });
    } catch (error) {
      authLogger.error('Password reset OTP verification with session failed', {
        error: error.message
      });
      next(error);
    }
  }

  // POST /api/v1/auth/complete-session-password-reset
  async completeSessionPasswordReset(req, res, next) {
    try {
      const { sessionToken, newPassword } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;

      console.log('Attempting password reset with session token:', sessionToken ? sessionToken.substring(0, 8) + '...' : 'undefined');
      
      // Store session token in Redis temporarily for debugging
      const { cache } = require('../config/redis');
      const debugKey = `debug:token:${Date.now()}`;
      await cache.set(debugKey, sessionToken, 300);
      
      // Direct approach: Find the user associated with this session
      const redisClient = require('../config/redis').getRedisClient();
      const sessionKey = `pwreset:session:${sessionToken}`;
      
      // Use direct Redis client to get the session
      const rawSession = await redisClient.get(sessionKey);
      console.log('Direct Redis value for session:', rawSession);
      
      if (!rawSession) {
        console.log('No session found directly from Redis');
        throw new Error('Session not found in Redis');
      }
      
      // Parse the JSON
      const sessionData = JSON.parse(rawSession);
      console.log('Session data parsed directly:', sessionData);
      
      // Find the user
      const User = require('../models/User.model');
      const user = await User.findById(sessionData.userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Update password directly
      user.password = newPassword;
      user.metadata.passwordChangedAt = Date.now();
      await user.save();
      
      // Delete the session
      await redisClient.del(sessionKey);
      
      // Log success
      const AuditLog = require('../models/AuditLog.model');
      const { AUDIT_ACTIONS } = require('../utils/constants');
      
      await AuditLog.logAction({
        userId: user._id,
        action: AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
        resource: 'user',
        resourceId: user._id,
        details: { method: 'direct_reset' },
        ipAddress,
        result: { success: true },
      });
      
      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      authLogger.error('Complete session password reset failed', {
        error: error.message
      });
      next(error);
    }
  }
}

const controller = new AuthController();
module.exports = controller; 
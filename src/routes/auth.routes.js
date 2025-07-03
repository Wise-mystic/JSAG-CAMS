const express = require('express');
const AuthController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');
const { authSchemas } = require('../utils/validators');
const router = express.Router();

// Rate limiters for different auth operations
const isDevelopment = process.env.NODE_ENV === 'development';

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 50 : 5, // More lenient in development
  message: 'Too many login attempts, please try again later',
  skipSuccessfulRequests: true
});

const otpLimiter = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isDevelopment ? 30 : 3, // More lenient in development
  message: 'Too many OTP attempts, please wait before trying again'
});

const passwordResetLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 30 : 3, // More lenient in development
  message: 'Too many password reset attempts, please try again later'
});

const registrationLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 30 : 3, // More lenient in development
  message: 'Too many registration attempts, please try again later'
});

// Public auth routes (no authentication required)
router.post('/register', 
  registrationLimiter,
  validateRequest(authSchemas.register),
  AuthController.register
);

router.post('/verify-otp', 
  otpLimiter,
  validateRequest(authSchemas.verifyOTP),
  AuthController.verifyOtp
);

router.post('/login', 
  loginLimiter,
  validateRequest(authSchemas.login),
  AuthController.login
);

router.post('/forgot-password', 
  passwordResetLimiter,
  validateRequest(authSchemas.forgotPassword),
  AuthController.forgotPassword
);

router.post('/verify-password-reset-session', 
  passwordResetLimiter,
  validateRequest(authSchemas.verifyPasswordResetSession),
  AuthController.verifyPasswordResetWithSession
);

router.post('/complete-session-password-reset', 
  passwordResetLimiter,
  (req, res, next) => {
    console.log('Password reset completion request body:', {
      sessionToken: req.body.sessionToken ? `${req.body.sessionToken.substring(0, 8)}...` : undefined,
      hasNewPassword: !!req.body.newPassword,
      hasConfirmPassword: !!req.body.confirmPassword
    });
    next();
  },
  validateRequest(authSchemas.completeSessionPasswordReset),
  AuthController.completeSessionPasswordReset
);

router.post('/verify-password-reset-otp', 
  passwordResetLimiter,
  validateRequest(authSchemas.verifyOTP),
  AuthController.verifyPasswordResetOtp
);

router.post('/complete-password-reset', 
  passwordResetLimiter,
  validateRequest(authSchemas.completePasswordReset),
  AuthController.completePasswordReset
);

router.post('/reset-password', 
  passwordResetLimiter,
  validateRequest(authSchemas.resetPassword),
  AuthController.resetPassword
);

router.post('/resend-otp', 
  otpLimiter,
  validateRequest(authSchemas.verifyOTP),
  AuthController.resendOtp
);

// Protected auth routes (authentication required)
router.post('/refresh-token', 
  authenticate,
  AuthController.refreshToken
);

router.post('/change-password', 
  authenticate,
  validateRequest(authSchemas.resetPassword),
  AuthController.changePassword
);

router.post('/logout', 
  authenticate,
  AuthController.logout
);

router.get('/me', 
  authenticate,
  AuthController.getMe
);

// Additional security endpoints
router.post('/verify-session', 
  authenticate,
  AuthController.verifySession
);

router.get('/security-log', 
  authenticate,
  AuthController.getSecurityLog
);

router.post('/revoke-all-sessions', 
  authenticate,
  passwordResetLimiter,
  AuthController.revokeAllSessions
);

module.exports = router; 
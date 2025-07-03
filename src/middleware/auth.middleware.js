const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const config = require('../config/environment');
const { sessionOperations } = require('../config/redis');
const { ApiError } = require('./error.middleware');
const { ERROR_CODES } = require('../utils/constants');

// Verify JWT token middleware
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    if (!token) {
      throw ApiError.unauthorized('Access token required', ERROR_CODES.UNAUTHORIZED);
    }
    
    // Check if token is blacklisted
    const isBlacklisted = await sessionOperations.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw ApiError.unauthorized('Token has been revoked', ERROR_CODES.TOKEN_INVALID);
    }
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Token has expired', ERROR_CODES.TOKEN_EXPIRED);
      } else if (error.name === 'JsonWebTokenError') {
        throw ApiError.unauthorized('Invalid token', ERROR_CODES.TOKEN_INVALID);
      }
      throw error;
    }
    
    // Get user from database
    const user = await User.findById(decoded.userId)
      .select('-password')
      .populate('departmentId', 'name')
      .populate('ministryId', 'name')
      .populate('prayerTribes', 'name dayOfWeek');
    
    if (!user) {
      throw ApiError.unauthorized('User not found', ERROR_CODES.USER_NOT_FOUND);
    }
    
    // Check if user is active
    if (!user.isActive) {
      throw ApiError.forbidden('Account is inactive', ERROR_CODES.ACCOUNT_INACTIVE);
    }
    
    // Check if password was changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      throw ApiError.unauthorized(
        'Password was changed recently. Please login again',
        ERROR_CODES.TOKEN_INVALID
      );
    }
    
    // Attach user to request
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    next(error);
  }
};

// Alias for authenticateToken
const authenticate = authenticateToken;

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    if (!token) {
      return next();
    }
    
    // Check if token is blacklisted
    const isBlacklisted = await sessionOperations.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return next();
    }
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (error) {
      return next();
    }
    
    // Get user from database
    const user = await User.findById(decoded.userId)
      .select('-password')
      .populate('departmentId', 'name')
      .populate('ministryId', 'name')
      .populate('prayerTribes', 'name dayOfWeek');
    
    if (user && user.isActive) {
      req.user = user;
      req.token = token;
    }
    
    next();
  } catch (error) {
    // Don't fail on errors for optional auth
    next();
  }
};

module.exports = {
  authenticateToken,
  authenticate,
  optionalAuth,
}; 
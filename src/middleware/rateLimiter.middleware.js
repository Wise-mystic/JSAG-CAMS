// Rate Limiter Middleware
// Handles API call throttling

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Create a rate limiter factory function
const rateLimiter = (options) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes default
    max: options.max || 100, // limit each IP to 100 requests per windowMs
    message: {
      success: false,
      message: options.message || 'Too many requests from this IP, please try again later'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded:', {
        ip: req.ip,
        path: req.path,
        method: req.method
      });
      res.status(429).json({
        success: false,
        message: options.message || 'Too many requests, please try again later',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
    }
  });
};

module.exports = { rateLimiter }; 
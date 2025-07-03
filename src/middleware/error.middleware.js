const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/constants');

// Custom API Error class
class ApiError extends Error {
  constructor(statusCode, message, errorCode = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
  
  static badRequest(message, errorCode = ERROR_CODES.VALIDATION_ERROR, details = null) {
    return new ApiError(400, message, errorCode, details);
  }
  
  static unauthorized(message = 'Unauthorized', errorCode = ERROR_CODES.UNAUTHORIZED) {
    return new ApiError(401, message, errorCode);
  }
  
  static forbidden(message = 'Forbidden', errorCode = ERROR_CODES.FORBIDDEN) {
    return new ApiError(403, message, errorCode);
  }
  
  static notFound(message = 'Resource not found', errorCode = ERROR_CODES.RESOURCE_NOT_FOUND) {
    return new ApiError(404, message, errorCode);
  }
  
  static conflict(message, errorCode = ERROR_CODES.DUPLICATE_ENTRY) {
    return new ApiError(409, message, errorCode);
  }
  
  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }
  
  static internal(message = 'Internal server error', errorCode = ERROR_CODES.INTERNAL_ERROR) {
    return new ApiError(500, message, errorCode);
  }
}

// MongoDB error handler
const handleMongoError = (error) => {
  if (error.code === 11000) {
    // Duplicate key error
    const field = Object.keys(error.keyPattern)[0];
    const value = error.keyValue[field];
    return ApiError.conflict(
      `${field} '${value}' already exists`,
      ERROR_CODES.DUPLICATE_ENTRY
    );
  }
  
  if (error.name === 'ValidationError') {
    // Mongoose validation error
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
    }));
    
    return ApiError.badRequest(
      'Validation failed',
      ERROR_CODES.VALIDATION_ERROR,
      errors
    );
  }
  
  if (error.name === 'CastError') {
    // Invalid ObjectId
    return ApiError.badRequest(
      `Invalid ${error.path}: ${error.value}`,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  
  return null;
};

// JWT error handler
const handleJWTError = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return ApiError.unauthorized('Invalid token', ERROR_CODES.TOKEN_INVALID);
  }
  
  if (error.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Token expired', ERROR_CODES.TOKEN_EXPIRED);
  }
  
  return null;
};

// Error response formatter
const sendErrorResponse = (res, error) => {
  const { statusCode, message, errorCode, details } = error;
  
  const response = {
    success: false,
    message,
    ...(errorCode && { errorCode }),
    ...(details && { details }),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  };
  
  res.status(statusCode).json(response);
};

// Global error handling middleware
const errorMiddleware = (err, req, res, next) => {
  // Handle ECONNRESET errors (client disconnected)
  if (err.code === 'ECONNRESET') {
    logger.warn('Client connection reset:', {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
    return; // Client already disconnected, no need to send response
  }
  
  // Handle client aborted connection
  if (err.code === 'EPIPE' || err.code === 'ECANCELED') {
    logger.warn('Client aborted connection:', {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
    return; // Client already disconnected, no need to send response
  }
  
  let error = err;
  
  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    user: req.user ? req.user.id : 'anonymous',
    code: err.code,
    name: err.name
  });
  
  // Check if response has already been sent
  if (res.headersSent) {
    logger.warn('Headers already sent, cannot send error response');
    return next(err);
  }
  
  // Handle specific error types
  if (!(error instanceof ApiError)) {
    // Check for MongoDB errors
    const mongoError = handleMongoError(err);
    if (mongoError) {
      error = mongoError;
    }
    // Check for JWT errors
    else if (handleJWTError(err)) {
      error = handleJWTError(err);
    }
    // Handle Joi validation errors
    else if (err.isJoi) {
      const details = err.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      
      error = ApiError.badRequest(
        'Validation failed',
        ERROR_CODES.VALIDATION_ERROR,
        details
      );
    }
    // Handle multer errors (file upload)
    else if (err.code === 'LIMIT_FILE_SIZE') {
      error = ApiError.badRequest(
        'File too large',
        ERROR_CODES.FILE_UPLOAD_ERROR
      );
    }
    // Handle network errors
    else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      error = ApiError.internal(
        'Request timed out',
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    // Default to internal server error
    else {
      error = ApiError.internal(
        process.env.NODE_ENV === 'production' 
          ? 'Something went wrong' 
          : err.message
      );
    }
  }
  
  try {
    // Send error response
    sendErrorResponse(res, error);
  } catch (responseError) {
    logger.error('Error sending error response:', responseError);
    // Attempt to send a simplified response
    res.status(500).json({
      success: false,
      message: 'An error occurred while processing your request'
    });
  }
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Not found handler
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.originalUrl} not found`));
};

module.exports = {
  errorMiddleware,
  ApiError,
  asyncHandler,
  notFoundHandler,
}; 
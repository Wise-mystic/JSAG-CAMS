const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/environment');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../', config.logging.dir);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'cams-backend' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    
    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    
    // Authentication logs
    new winston.transports.File({
      filename: path.join(logsDir, 'auth.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format((info) => {
          return info.category === 'auth' ? info : false;
        })(),
        logFormat
      ),
    }),
    
    // Event logs
    new winston.transports.File({
      filename: path.join(logsDir, 'events.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format((info) => {
          return info.category === 'events' ? info : false;
        })(),
        logFormat
      ),
    }),
    
    // Attendance logs
    new winston.transports.File({
      filename: path.join(logsDir, 'attendance.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format((info) => {
          return info.category === 'attendance' ? info : false;
        })(),
        logFormat
      ),
    }),
    
    // Audit logs
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format((info) => {
          return info.category === 'audit' ? info : false;
        })(),
        logFormat
      ),
    }),
    
    // Performance logs
    new winston.transports.File({
      filename: path.join(logsDir, 'performance.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format((info) => {
          return info.category === 'performance' ? info : false;
        })(),
        logFormat
      ),
    }),
  ],
});

// Add console transport for non-production environments
if (config.env !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug',
  }));
}

// Create specialized loggers
const authLogger = {
  info: (message, meta) => logger.info(message, { category: 'auth', ...meta }),
  error: (message, meta) => logger.error(message, { category: 'auth', ...meta }),
  warn: (message, meta) => logger.warn(message, { category: 'auth', ...meta }),
};

const eventLogger = {
  info: (message, meta) => logger.info(message, { category: 'events', ...meta }),
  error: (message, meta) => logger.error(message, { category: 'events', ...meta }),
  warn: (message, meta) => logger.warn(message, { category: 'events', ...meta }),
};

const attendanceLogger = {
  info: (message, meta) => logger.info(message, { category: 'attendance', ...meta }),
  error: (message, meta) => logger.error(message, { category: 'attendance', ...meta }),
  warn: (message, meta) => logger.warn(message, { category: 'attendance', ...meta }),
};

const auditLogger = {
  log: (action, userId, details) => {
    logger.info(`Audit: ${action}`, {
      category: 'audit',
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
    });
  },
};

const performanceLogger = {
  log: (operation, duration, details) => {
    logger.info(`Performance: ${operation}`, {
      category: 'performance',
      operation,
      duration,
      details,
      timestamp: new Date().toISOString(),
    });
  },
};

// Stream for Morgan HTTP logger
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = {
  logger,
  authLogger,
  eventLogger,
  attendanceLogger,
  auditLogger,
  performanceLogger,
  // Convenience methods
  info: logger.info.bind(logger),
  error: logger.error.bind(logger),
  warn: logger.warn.bind(logger),
  debug: logger.debug.bind(logger),
}; 
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import configurations
const config = require('./config/environment');
const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./utils/logger');

// Import middleware
const { errorMiddleware } = require('./middleware/error.middleware');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const departmentRoutes = require('./routes/department.routes');
const eventRoutes = require('./routes/event.routes');
const groupRoutes = require('./routes/groups.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const reportRoutes = require('./routes/report.routes');
const notificationRoutes = require('./routes/notification.routes');

// Import models to ensure they are registered with mongoose
require('./models/Subgroup.model');

// Initialize Express app
const app = express();

// Trust proxy (for deployment behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS configuration
app.use(cors(config.cors));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan('combined', { 
  stream: logger.stream,
  skip: (req, res) => res.statusCode < 400 
}));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.env === 'development' ? 1000 : config.rateLimit.maxRequests, // More lenient in development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
if (config.env !== 'development') {
  app.use('/api/', globalLimiter);
} else {
  console.log('Rate limiting disabled in development mode');
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'CAMS Backend API is running',
    service: 'Church Attendance Management System',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.env,
    endpoints: {
      health: '/health',
      detailedHealth: '/health/detailed',
      api: '/api/v1',
      documentation: '/api/v1/docs' // If you have API docs
    },
    apiRoutes: [
      '/api/v1/auth',
      '/api/v1/users', 
      '/api/v1/departments',
      '/api/v1/events',
      '/api/v1/groups',
      '/api/v1/attendance',
      '/api/v1/reports',
      '/api/v1/notifications'
    ]
  });
});

// Health check endpoints (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'CAMS Backend',
    version: process.env.npm_package_version || '1.0.0',
  });
});

app.get('/health/detailed', async (req, res) => {
  try {
    const dbHealth = await require('./config/database').healthCheck();
    const redisHealth = await require('./config/redis').healthCheck();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'CAMS Backend',
      version: process.env.npm_package_version || '1.0.0',
      components: {
        database: dbHealth,
        redis: redisHealth,
      },
      environment: config.env,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message,
    });
  }
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// Global error handler (must be last)
app.use(errorMiddleware);

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close database connections
      await require('./config/database').disconnectDB();
      logger.info('Database connection closed');
      
      // Close Redis connection
      await require('./config/redis').disconnectRedis();
      logger.info('Redis connection closed');
      
      // Close any other connections (e.g., message queues)
      // await closeQueueConnections();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
  
  // In development, don't shut down for unhandled rejections
  if (config.env === 'production') {
    gracefulShutdown('unhandledRejection');
  } else {
    logger.warn('Unhandled rejection in development mode - not shutting down');
  }
});

// Start server
let server;

const startServer = async () => {
  try {
    logger.info(`Starting CAMS Server...`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`Port: ${config.port}`);
    logger.info(`MongoDB URI: ${config.mongodb.uri ? 'Configured' : 'Missing'}`);
    logger.info(`Redis Host: ${config.redis.host}`);
    
    // Connect to MongoDB
    const dbConnected = await connectDB();
    if (dbConnected) {
      logger.info('Database connected successfully');
    } else {
      logger.warn('Database connection failed - continuing without DB');
    }
    
    // Connect to Redis (optional)
    try {
      await connectRedis();
      logger.info('Redis connected successfully');
    } catch (error) {
      logger.warn('Redis connection failed - continuing without cache:', error.message);
    }
    
    // Initialize background jobs
    // await initializeJobs();
    // logger.info('Background jobs initialized');
    
    // Start Express server
    server = app.listen(config.port, '0.0.0.0', () => {
      logger.info(`
        ################################################
        🚀 CAMS Server listening on port ${config.port}
        🌍 Environment: ${config.env}
        📅 Started at: ${new Date().toISOString()}
        🔗 Health Check: http://localhost:${config.port}/health
        📊 API Base: http://localhost:${config.port}/api/v1
        ################################################
      `);
    });
    
    // Add error handling for the server
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use. Please use a different port.`);
        process.exit(1);
      } else {
        logger.error('Server error:', error);
      }
    });
    
    // Add timeout and keep-alive settings
    server.keepAliveTimeout = 65000; // 65 seconds
    server.headersTimeout = 66000; // 66 seconds (slightly more than keepAliveTimeout)
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      env: config.env,
      port: config.port,
      mongoUri: config.mongodb.uri ? 'Set' : 'Missing'
    });
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app; 
const mongoose = require('mongoose');
const config = require('./environment');
const logger = require('../utils/logger');

// MongoDB connection options
const mongoOptions = {
  ...config.mongodb.options,
  maxPoolSize: 10,
  minPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    // Set mongoose options
    mongoose.set('strictQuery', true);
    
    // Event listeners for connection states
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
    });
    
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    });
    
    // Connect to MongoDB
    await mongoose.connect(config.mongodb.uri, mongoOptions);
    
  } catch (error) {
    logger.error('MongoDB initial connection failed:', error);
    // Exit process with failure
    process.exit(1);
  }
};

// Disconnect from MongoDB
const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
  }
};

// Get database connection status
const getConnectionStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  
  return {
    status: states[mongoose.connection.readyState] || 'unknown',
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    name: mongoose.connection.name,
  };
};

// Health check for database
const healthCheck = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { healthy: false, message: 'Database not connected' };
    }
    
    // Ping the database
    await mongoose.connection.db.admin().ping();
    
    return { 
      healthy: true, 
      message: 'Database is healthy',
      details: getConnectionStatus()
    };
  } catch (error) {
    return { 
      healthy: false, 
      message: 'Database health check failed',
      error: error.message 
    };
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus,
  healthCheck,
  mongoose
}; 
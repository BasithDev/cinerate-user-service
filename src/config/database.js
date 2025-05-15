const { Sequelize } = require('sequelize');
const defineUserModel = require('../models/user.model');
const { createMockUserModel, createMockSequelize } = require('../models/mock-user.model');

// Database variables
let sequelize;
let User;

/**
 * Initialize database models
 * @returns {object} User model
 */
async function initializeModels() {
  // If we're in test mode, User is already defined in connectToDatabase
  if (process.env.NODE_ENV !== 'test') {
    // Define User model for production mode
    User = defineUserModel(sequelize);

    // Sync models with database
    await sequelize.sync();
  }

  return User;
}

/**
 * Connect to the database with retry mechanism
 * @param {string} uri - Database connection URI
 */
async function connectToDatabase(uri) {
  try {
    // Check if we're in test mode or if USE_MOCK_DB is set
    if (process.env.NODE_ENV === 'test' || process.env.USE_MOCK_DB === 'true') {
      console.log('Running with mock database');
      
      // Create mock User model and sequelize instance
      User = createMockUserModel();
      sequelize = createMockSequelize(User);
      
      return;
    }
    
    // Get database connection parameters from environment variables for Kubernetes support
    const DB_HOST = process.env.DB_HOST || 'user-postgres-svc';
    const DB_PORT = process.env.DB_PORT || '5432';
    const DB_NAME = process.env.DB_NAME || 'cinerate_user_db';
    const DB_USER = process.env.DB_USER || 'postgres';
    const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
    
    // If URI is provided, use it, otherwise construct from individual params
    const connectionString = uri || `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
    
    sequelize = new Sequelize(connectionString, {
      dialect: 'postgres',
      logging: false,
      pool: {
        max: 10,            // Increased from 5 to 10 for more connections
        min: 2,             // Increased from 0 to 2 to maintain minimum connections
        acquire: 60000,     // Increased from 30000 to 60000 ms
        idle: 20000,        // Increased from 10000 to 20000 ms
        evict: 30000        // Added eviction time for stale connections
      },
      retry: {
        max: 5,             // Increased from 3 to 5 retries
        timeout: 60000      // Increased from 30000 to 60000 ms
      },
      dialectOptions: {
        connectTimeout: 60000 // Added explicit connection timeout
      }
    });
    
    try {
      await sequelize.authenticate();
      console.log(`Connected to database (${sequelize.getDialect()})`);
    } catch (error) {
      // If the database doesn't exist, try to create it
      if (error.original && error.original.code === '3D000') { // Database does not exist error code
        console.log(`Database ${DB_NAME} does not exist. Attempting to create it...`);
        
        // Create a connection to the default 'postgres' database to create our database
        const adminSequelize = new Sequelize(`postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`, {
          dialect: 'postgres',
          logging: false
        });
        
        try {
          await adminSequelize.authenticate();
          await adminSequelize.query(`CREATE DATABASE ${DB_NAME};`);
          await adminSequelize.close();
          console.log(`Database ${DB_NAME} created successfully.`);
          
          // Reconnect to the newly created database
          await sequelize.authenticate();
          console.log(`Connected to database (${sequelize.getDialect()})`);
        } catch (createError) {
          console.error('Failed to create database:', createError);
          throw createError;
        }
      } else {
        throw error;
      }
    }
    
    await initializeModels();
    console.log('Database models initialized');
    
  } catch (err) {
    // Log error without trying to reconstruct the connection string
    console.log('Database connection error');
    console.error('Failed to connect to PostgreSQL', err);
    const retryDelayMs = 5000;
    console.log(`Retrying connection in ${retryDelayMs / 1000} seconds...`);
    setTimeout(() => connectToDatabase(uri), retryDelayMs);
  }
}

/**
 * Set up database connection event handlers
 */
function setupDatabaseEventHandlers() {
  process.on('SIGINT', async () => {
    if (sequelize) {
      await sequelize.close();
      console.log('Database connection closed');
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    if (sequelize) {
      await sequelize.close();
      console.log('Database connection closed');
    }
    process.exit(0);
  });
}

module.exports = {
  connectToDatabase,
  setupDatabaseEventHandlers,
  getSequelize: () => sequelize,
  getUser: () => User
};

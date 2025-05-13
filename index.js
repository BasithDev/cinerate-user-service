const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv').config();
const retry = require('async-retry');
const CircuitBreaker = require('opossum');
const promClient = require('prom-client');
const promBundle = require('express-prom-bundle');
const RedisCache = require('./redis-cache');
const JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret-for-development';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Using default JWT_SECRET in production environment!');
}

// Initialize Prometheus metrics collection
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  customLabels: { service: 'user-service' },
  promClient: {
    collectDefaultMetrics: {
      timeout: 5000
    }
  }
});

// Create custom metrics
const dbOperationDuration = new promClient.Histogram({
  name: 'db_operation_duration_seconds',
  help: 'Duration of database operations in seconds',
  labelNames: ['operation', 'success'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const circuitBreakerState = new promClient.Gauge({
  name: 'circuit_breaker_state',
  help: 'State of the circuit breaker (1 = closed, 0 = open)',
  labelNames: ['breaker']
});

const app = express();

// Initialize Redis cache
const redisCache = new RedisCache({
  prefix: 'user-service:',
  ttl: 3600 // 1 hour default TTL
});

// Apply metrics middleware
app.use(metricsMiddleware);
app.use(express.json());

// Database connection setup
let sequelize;
let User;

// Circuit breaker for database operations
const dbCircuitOptions = {
  failureThreshold: 50,
  resetTimeout: 10000,
  timeout: 3000,
  errorThresholdPercentage: 50
};

// Initialize database models
async function initializeModels() {
  // If we're in test mode, User is already defined in connectToDatabase
  if (process.env.NODE_ENV !== 'test') {
    // Define User model for production mode
    User = sequelize.define('User', {
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      }
    });

    // Sync models with database
    await sequelize.sync();
  }

  return User;
}

// Create a circuit breaker for database operations
const dbCircuitBreaker = new CircuitBreaker(async (operation, operationName = 'unknown') => {
  const startTime = process.hrtime();
  let success = false;
  
  try {
    const result = await retry(async (bail) => {
      try {
        return await operation();
      } catch (err) {
        if (err.name === 'SequelizeConnectionError' || 
            err.name === 'SequelizeConnectionRefusedError' || 
            err.name === 'SequelizeHostNotFoundError' || 
            err.name === 'SequelizeConnectionTimedOutError') {
          throw err; // Retry on connection errors
        } else {
          bail(err); // Don't retry on other errors
          return;
        }
      }
    }, {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 5000,
      factor: 2,
      randomize: true,
      onRetry: (err) => {
        console.log(`Retrying database operation after error: ${err.message}`);
      }
    });
    
    success = true;
    return result;
  } finally {
    // Record operation duration
    const duration = process.hrtime(startTime);
    const durationSeconds = duration[0] + duration[1] / 1e9;
    dbOperationDuration.observe({ operation: operationName, success: success }, durationSeconds);
  }
}, dbCircuitOptions);

// Add circuit breaker event listeners to track metrics
dbCircuitBreaker.on('open', () => {
  console.log('Circuit breaker opened');
  circuitBreakerState.set({ breaker: 'database' }, 0);
});

dbCircuitBreaker.on('close', () => {
  console.log('Circuit breaker closed');
  circuitBreakerState.set({ breaker: 'database' }, 1);
});

dbCircuitBreaker.on('halfOpen', () => {
  console.log('Circuit breaker half-open');
  circuitBreakerState.set({ breaker: 'database' }, 0.5);
});

// Initialize circuit breaker state metric
circuitBreakerState.set({ breaker: 'database' }, 1);

app.get('/test', (req, res) => {
  res.send('User service is running');
});

// Add a comprehensive health check endpoint
app.get('/health', async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    dbConnection: sequelize ? 'connected' : 'disconnected',
    redisConnection: redisCache.connected ? 'connected' : 'disconnected'
  };

  try {
    await dbCircuitBreaker.fire(async () => {
      await sequelize.authenticate();
      return true;
    }, 'health_check');
    healthcheck.dbPing = 'successful';
    
    // Check Redis connection
    if (!redisCache.connected) {
      try {
        await redisCache.connect();
        healthcheck.redisPing = 'successful';
      } catch (redisError) {
        healthcheck.redisPing = 'failed';
        healthcheck.redisError = redisError.message;
      }
    } else {
      healthcheck.redisPing = 'successful';
    }
    
    res.status(200).json(healthcheck);
  } catch (error) {
    healthcheck.message = error.message;
    healthcheck.dbPing = 'failed';
    res.status(503).json(healthcheck);
  }
});

// Apply cache middleware to GET routes
app.get('/:id', redisCache.cacheMiddleware(300), async (req, res) => {
  const userId = req.params.id;
  if (!userId) return res.status(400).send('No user ID provided');

  try {
    const user = await dbCircuitBreaker.fire(async () => {
      return await User.findByPk(userId);
    });
    
    if (!user) return res.status(404).send('User not found');

    res.json({ name: user.name, email: user.email });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).send('Internal server error');
  }
});

app.post('/update', async (req, res) => {
  const { userId, name, email } = req.body;
  
  try {
    const [updated] = await dbCircuitBreaker.fire(async () => {
      return await User.update(
        { name, email },
        { where: { id: userId } }
      );
    }, 'update_user');
    
    if (updated === 0) {
      return res.status(404).send('User not found');
    }
    
    // Invalidate user cache after update
    await redisCache.del(userId);
    
    res.json({ message: 'User updated' });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).send('Internal server error');
  }
});

app.post('/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  
  try {
    const user = await dbCircuitBreaker.fire(async () => {
      return await User.findByPk(userId);
    });
    
    if (!user) return res.status(404).send('User not found');

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).send('Invalid credentials');

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await dbCircuitBreaker.fire(async () => {
      user.password = hashedPassword;
      return await user.save();
    }, 'update_user_password');

    res.json({ message: 'Password changed' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).send('Internal server error');
  }
});

app.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await dbCircuitBreaker.fire(async () => {
      return await User.create({ email, password: hashedPassword, name });
    }, 'create_user');
    
    res.status(201).json({ message: 'User created' });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Email already in use' });
    }
    console.error('Error creating user:', error);
    res.status(500).send('Internal server error');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await dbCircuitBreaker.fire(async () => {
      return await User.findOne({ where: { email } });
    }, 'find_user_by_email');
    
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '3h' });

    res.json({ accessToken, userId: user.id, name: user.name });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).send('Internal server error');
  }
});

// Robust error logging middleware for debugging
app.use((err, req, res, next) => {
  console.error('Express error:', err.stack || err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

async function connectToDatabase(uri) {
  try {
    // Check if we're in test mode
    if (process.env.NODE_ENV === 'test') {
      console.log('Running in test mode - using mock database');
      
      // Mock user data store for tests
      const mockUsers = [];
      let mockUserId = 1;
      
      // Create a mock User model
      User = {
        findAll: async () => mockUsers,
        findOne: async (query) => {
          let user = null;
          if (query.where.id) {
            user = mockUsers.find(user => user.id === query.where.id) || null;
          } else if (query.where.email) {
            user = mockUsers.find(user => user.email === query.where.email) || null;
          }
          
          if (user) {
            // Add save method to the user object
            user.save = async () => {
              const index = mockUsers.findIndex(u => u.id === user.id);
              if (index >= 0) {
                mockUsers[index] = { ...user };
                return user;
              }
              return null;
            };
          }
          return user;
        },
        findByPk: async (id) => {
          const user = mockUsers.find(user => user.id === parseInt(id)) || null;
          if (user) {
            // Add save method to the user object
            user.save = async () => {
              const index = mockUsers.findIndex(u => u.id === user.id);
              if (index >= 0) {
                mockUsers[index] = { ...user };
                return user;
              }
              return null;
            };
          }
          return user;
        },
        create: async (data) => {
          const newUser = { ...data, id: mockUserId++ };
          mockUsers.push(newUser);
          return newUser;
        },
        update: async (data, query) => {
          const userIndex = mockUsers.findIndex(user => user.id === query.where.id);
          if (userIndex >= 0) {
            mockUsers[userIndex] = { ...mockUsers[userIndex], ...data };
            return [1];  // Return 1 row affected
          }
          return [0];
        },
        destroy: async (query) => {
          const initialLength = mockUsers.length;
          const userIndex = mockUsers.findIndex(user => user.id === query.where.id);
          if (userIndex >= 0) {
            mockUsers.splice(userIndex, 1);
            return initialLength - mockUsers.length; // Return number of rows affected
          }
          return 0;
        }
      };
      
      // Create a mock sequelize instance
      sequelize = {
        authenticate: async () => true,
        sync: async () => true,
        define: (modelName, attributes, options) => {
          // We've already defined User above, so just return it
          return User;
        },
        getDialect: () => 'postgres (mock)',
        drop: async () => true,
        close: async () => true
      };
      
      return;
    }
    
    // Get database connection parameters from environment variables for Kubernetes support
    const DB_HOST = process.env.DB_HOST || 'localhost';
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
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      },
      retry: {
        max: 3,
        timeout: 30000
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
    console.error('Failed to connect to PostgreSQL', err);
    const retryDelayMs = 5000;
    console.log(`Retrying connection in ${retryDelayMs / 1000} seconds...`);
    setTimeout(() => connectToDatabase(uri), retryDelayMs);
  }
}

// Handle application termination
process.on('SIGINT', async () => {
  if (sequelize) {
    await sequelize.close();
    console.log('Database connection closed');
  }
  if (redisCache.connected) {
    await redisCache.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (sequelize) {
    await sequelize.close();
    console.log('Database connection closed');
  }
  if (redisCache.connected) {
    await redisCache.close();
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3001;

// Connect to database, Redis and start server
const dbUri = process.env.DB_URI || `postgres://postgres:postgres@localhost:5432/${process.env.DB_NAME || 'cinerate_user_db'}`;
connectToDatabase(dbUri)
  .then(async () => {
    try {
      await redisCache.connect();
      console.log('Connected to Redis');
    } catch (redisError) {
      console.warn('Warning: Could not connect to Redis:', redisError.message);
      console.warn('Service will run without caching');
    }
    
    // Start the server
    app.server = app.listen(PORT, () => {
      console.log(`User service running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

// Make sequelize available for testing
global.sequelize = sequelize;

module.exports = { app, connectToDatabase, sequelize };
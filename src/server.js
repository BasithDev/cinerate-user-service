const { app, redisCache } = require('./app');
const { connectToDatabase, setupDatabaseEventHandlers } = require('./config/database');

// Setup database connection event handlers
setupDatabaseEventHandlers();

// Handle Redis closure on application termination
process.on('SIGINT', async () => {
  if (redisCache.connected) {
    await redisCache.close();
    // Only log Redis closure here, not in the RedisCache.close() method
    console.log('Redis connection closed');
  }
});

process.on('SIGTERM', async () => {
  if (redisCache.connected) {
    await redisCache.close();
    // Only log Redis closure here, not in the RedisCache.close() method
    console.log('Redis connection closed');
  }
});

/**
 * Start the server
 */
async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();
    
    // Connect to Redis
    try {
      await redisCache.connect();
      // Redis client will log connection via event handler
    } catch (redisError) {
      console.warn('Warning: Could not connect to Redis:', redisError.message);
      console.warn('Service will run without caching');
    }
    
    // Start the server
    const PORT = process.env.PORT || 3001;
    app.server = app.listen(PORT, () => {
      console.log(`User service running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = { startServer };

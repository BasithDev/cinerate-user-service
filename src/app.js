const express = require('express');
const createMetricsMiddleware = require('./middleware/metrics.middleware');
const createCacheMiddleware = require('./middleware/cache.middleware');
const errorMiddleware = require('./middleware/error.middleware');
const createUserRoutes = require('./routes/user.routes');
const createHealthRoutes = require('./routes/health.routes');
const UserController = require('./controllers/user.controller');
const HealthController = require('./controllers/health.controller');
const { createDatabaseCircuitBreaker } = require('./config/circuit-breaker');

/**
 * Create and configure Express application
 * @returns {object} Express app and resources
 */
function createApp() {
  const app = express();

  // Create circuit breaker
  const dbCircuitBreaker = createDatabaseCircuitBreaker();

  // Initialize controllers
  const userController = new UserController(dbCircuitBreaker);
  const healthController = new HealthController(dbCircuitBreaker);

  // Initialize Redis cache middleware
  const { redisCache, attachRedisCache, cacheRoute } = createCacheMiddleware();

  // Apply middlewares
  app.use(createMetricsMiddleware());
  app.use(express.json());
  app.use(attachRedisCache);

  // Apply routes
  app.use('/', createHealthRoutes(healthController));
  app.use('/', createUserRoutes(userController, cacheRoute));

  // Apply error middleware
  app.use(errorMiddleware);

  return { app, redisCache };
}

module.exports = createApp();

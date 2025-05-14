const { getSequelize } = require('../config/database');

class HealthController {
  constructor(dbCircuitBreaker) {
    this.dbCircuitBreaker = dbCircuitBreaker;
  }

  /**
   * Test endpoint
   */
  testEndpoint(req, res) {
    res.send('User service is running');
  }

  /**
   * Comprehensive health check endpoint
   */
  async checkHealth(req, res) {
    const sequelize = getSequelize();
    const healthcheck = {
      uptime: process.uptime(),
      message: 'OK',
      timestamp: Date.now(),
      dbConnection: sequelize ? 'connected' : 'disconnected',
      redisConnection: req.redisCache && req.redisCache.connected ? 'connected' : 'disconnected'
    };

    try {
      await this.dbCircuitBreaker.fire(async () => {
        await sequelize.authenticate();
        return true;
      }, 'health_check');
      healthcheck.dbPing = 'successful';
      
      // Check Redis connection
      if (req.redisCache) {
        if (!req.redisCache.connected) {
          try {
            await req.redisCache.connect();
            healthcheck.redisPing = 'successful';
          } catch (redisError) {
            healthcheck.redisPing = 'failed';
            healthcheck.redisError = redisError.message;
          }
        } else {
          healthcheck.redisPing = 'successful';
        }
      } else {
        healthcheck.redisPing = 'not configured';
      }
      
      res.status(200).json(healthcheck);
    } catch (error) {
      healthcheck.message = error.message;
      healthcheck.dbPing = 'failed';
      res.status(503).json(healthcheck);
    }
  }
}

module.exports = HealthController;

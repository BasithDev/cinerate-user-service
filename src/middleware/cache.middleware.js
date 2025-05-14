const RedisCache = require('../utils/redis-cache');

/**
 * Create and initialize Redis cache middleware
 * @returns {object} Redis cache middleware
 */
function createCacheMiddleware() {
  const redisCache = new RedisCache({
    prefix: 'user-service:',
    ttl: 3600 // 1 hour default TTL
  });

  return {
    redisCache,
    
    // Attach Redis cache to request object
    attachRedisCache: (req, res, next) => {
      req.redisCache = redisCache;
      next();
    },
    
    // Cache middleware for routes
    cacheRoute: (ttl) => redisCache.cacheMiddleware(ttl)
  };
}

module.exports = createCacheMiddleware;

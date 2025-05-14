const promClient = require('prom-client');
const promBundle = require('express-prom-bundle');

/**
 * Create and configure Prometheus metrics middleware
 * @returns {Function} Express middleware for metrics
 */
function createMetricsMiddleware() {
  return promBundle({
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
}

module.exports = createMetricsMiddleware;

const express = require('express');

/**
 * Create health routes
 * @param {object} healthController - Health controller instance
 * @returns {Router} Express router
 */
function createHealthRoutes(healthController) {
  const router = express.Router();

  // Test endpoint
  router.get('/test', healthController.testEndpoint.bind(healthController));

  // Health check endpoint
  router.get('/health', healthController.checkHealth.bind(healthController));

  return router;
}

module.exports = createHealthRoutes;

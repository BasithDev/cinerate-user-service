const express = require('express');

/**
 * Create user routes
 * @param {object} userController - User controller instance
 * @param {Function} cacheRoute - Cache middleware function
 * @returns {Router} Express router
 */
function createUserRoutes(userController, cacheRoute) {
  const router = express.Router();

  // User signup
  router.post('/signup', userController.signup.bind(userController));

  // User login
  router.post('/login', userController.login.bind(userController));
  
  // Update user profile
  router.post('/update', userController.updateUser.bind(userController));

  // Change password
  router.post('/change-password', userController.changePassword.bind(userController));
  
  // Get user by ID (with cache) - MUST be last to avoid catching other routes
  router.get('/:id', cacheRoute(300), userController.getUserById.bind(userController));

  return router;
}

module.exports = createUserRoutes;

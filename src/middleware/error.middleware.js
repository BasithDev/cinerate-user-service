/**
 * Global error handling middleware
 */
function errorMiddleware(err, req, res, next) {
  console.error('Express error:', err.stack || err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
}

module.exports = errorMiddleware;

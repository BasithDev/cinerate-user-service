const CircuitBreaker = require('opossum');
const retry = require('async-retry');
const promClient = require('prom-client');

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

// Circuit breaker options for database operations
const dbCircuitOptions = {
  failureThreshold: 50,
  resetTimeout: 30000,    // Increased from 10000 to 30000 ms
  timeout: 10000,         // Increased from 3000 to 10000 ms
  errorThresholdPercentage: 50,
  rollingCountTimeout: 60000  // Added to track failures over a longer period
};

/**
 * Create a circuit breaker for database operations
 * @returns {CircuitBreaker} Database circuit breaker
 */
function createDatabaseCircuitBreaker() {
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
        retries: 5,                 // Increased from 3 to 5 retries
        minTimeout: 1000,
        maxTimeout: 8000,           // Increased from 5000 to 8000 ms
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
  
  return dbCircuitBreaker;
}

module.exports = {
  createDatabaseCircuitBreaker,
  dbOperationDuration,
  circuitBreakerState
};

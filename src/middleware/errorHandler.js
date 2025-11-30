/**
 * Error Handler Middleware
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('ErrorHandler');

export const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const isDev = process.env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
};

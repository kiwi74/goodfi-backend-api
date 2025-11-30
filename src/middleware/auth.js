/**
 * Authentication Middleware
 */

import { supabase } from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AuthMiddleware');

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No authorization token provided'
      });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('Invalid token attempt');
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        message: 'Please log in again'
      });
    }

    req.user = user;
    req.token = token;
    next();

  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Request Validation Middleware
 */

export const validateAssetCreation = (req, res, next) => {
  const { type, value, description } = req.body;
  const errors = [];

  if (!type || !['deposit', 'purchase_order', 'invoice'].includes(type)) {
    errors.push('Invalid asset type. Must be: deposit, purchase_order, or invoice');
  }

  if (!value || value <= 0) {
    errors.push('Value must be a positive number');
  }

  if (!description || description.trim().length < 10) {
    errors.push('Description must be at least 10 characters');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

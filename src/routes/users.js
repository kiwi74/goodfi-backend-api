import express from 'express';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();
router.get('/profile', authenticate, async (req, res) => {
  res.json({ success: true, message: 'User profile endpoint - to be implemented' });
});
export default router;

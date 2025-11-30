import express from 'express';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();
router.post('/create', authenticate, async (req, res) => {
  res.json({ success: true, message: 'Dispute endpoint - to be implemented' });
});
export default router;

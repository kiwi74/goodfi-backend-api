/**
 * Escrow Milestone Routes
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('MilestonesAPI');

// ==================== SUBMIT MILESTONE ====================
// POST /api/milestones/:id/submit
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { evidence_description, evidence_url } = req.body;
    const smeId = req.user.id;

    logger.info(`SME ${smeId} submitting milestone ${id}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get milestone and check access
    const { data: milestone, error: fetchError } = await supabaseAdmin
      .from('escrow_milestones')
      .select('*, escrows(sme_id)')
      .eq('id', id)
      .single();

    if (fetchError || !milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    if (milestone.escrows.sme_id !== smeId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (milestone.status !== 'pending' && milestone.status !== 'rejected') {
      return res.status(400).json({ success: false, error: 'Milestone already submitted' });
    }

    // Update milestone
    const { error: updateError } = await supabaseAdmin
      .from('escrow_milestones')
      .update({
        status: 'submitted',
        evidence_description,
        evidence_url,
        submitted_at: new Date().toISOString(),
        submitted_by: smeId
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: milestone.escrow_id,
      milestone_id: id,
      user_id: smeId,
      action_type: 'milestone_submitted',
      description: `Milestone "${milestone.title}" submitted for approval`
    });

    logger.info(`Milestone ${id} submitted`);

    res.json({
      success: true,
      message: 'Milestone submitted for approval'
    });

  } catch (error) {
    logger.error('Failed to submit milestone:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit milestone',
      message: error.message
    });
  }
});

// ==================== APPROVE MILESTONE ====================
// POST /api/milestones/:id/approve
router.post('/:id/approve', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.user.id;

    logger.info(`Customer ${customerId} approving milestone ${id}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get milestone and escrow
    const { data: milestone, error: fetchError } = await supabaseAdmin
      .from('escrow_milestones')
      .select('*, escrows(customer_id, released_amount)')
      .eq('id', id)
      .single();

    if (fetchError || !milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    if (milestone.escrows.customer_id !== customerId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (milestone.status !== 'submitted') {
      return res.status(400).json({ success: false, error: 'Milestone not ready for approval' });
    }

    // Update milestone
    const { error: milestoneError } = await supabaseAdmin
      .from('escrow_milestones')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: customerId,
        released_at: new Date().toISOString()
      })
      .eq('id', id);

    if (milestoneError) throw new Error(milestoneError.message);

    // Update escrow released amount
    const newReleasedAmount = parseFloat(milestone.escrows.released_amount || 0) + parseFloat(milestone.amount);
    
    const { error: escrowError } = await supabaseAdmin
      .from('escrows')
      .update({
        released_amount: newReleasedAmount
      })
      .eq('id', milestone.escrow_id);

    if (escrowError) throw new Error(escrowError.message);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: milestone.escrow_id,
      milestone_id: id,
      user_id: customerId,
      action_type: 'milestone_approved',
      description: `Milestone "${milestone.title}" approved - $${milestone.amount} released`,
      metadata: { amount: milestone.amount }
    });

    logger.info(`Milestone ${id} approved and funds released`);

    res.json({
      success: true,
      message: 'Milestone approved and funds released'
    });

  } catch (error) {
    logger.error('Failed to approve milestone:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve milestone',
      message: error.message
    });
  }
});

// ==================== REJECT MILESTONE ====================
// POST /api/milestones/:id/reject
router.post('/:id/reject', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const customerId = req.user.id;

    if (!rejection_reason) {
      return res.status(400).json({ success: false, error: 'Rejection reason required' });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get milestone
    const { data: milestone, error: fetchError } = await supabaseAdmin
      .from('escrow_milestones')
      .select('*, escrows(customer_id)')
      .eq('id', id)
      .single();

    if (fetchError || !milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    if (milestone.escrows.customer_id !== customerId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Update milestone
    const { error: updateError } = await supabaseAdmin
      .from('escrow_milestones')
      .update({
        status: 'rejected',
        rejection_reason
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: milestone.escrow_id,
      milestone_id: id,
      user_id: customerId,
      action_type: 'milestone_rejected',
      description: `Milestone "${milestone.title}" rejected`,
      metadata: { reason: rejection_reason }
    });

    logger.info(`Milestone ${id} rejected`);

    res.json({
      success: true,
      message: 'Milestone rejected'
    });

  } catch (error) {
    logger.error('Failed to reject milestone:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject milestone',
      message: error.message
    });
  }
});

export default router;

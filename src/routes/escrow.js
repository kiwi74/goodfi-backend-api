/**
 * Escrow API Routes
 * Handles project escrow with milestone-based payments
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { blockchainService } from '../services/blockchain.js';
import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const router = express.Router();
const logger = createLogger('EscrowAPI');

// ==================== CREATE ESCROW ====================
// POST /api/escrow/create
router.post('/create', authenticate, async (req, res) => {
  try {
    const {
      project_name,
      project_description,
      customer_email,
      total_amount,
      deposit_due_date,
      milestones
    } = req.body;
    
    const smeId = req.user.id;

    logger.info(`SME ${smeId} creating escrow: ${project_name} for ${customer_email}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Validate milestones
    if (!milestones || milestones.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one milestone is required' });
    }

    const totalPercentage = milestones.reduce((sum, m) => sum + parseFloat(m.percentage), 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      return res.status(400).json({ 
        success: false, 
        error: 'Milestone percentages must add up to 100%' 
      });
    }

    // Generate invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');

    // Create escrow project
    const { data: escrow, error: escrowError } = await supabaseAdmin
      .from('escrows')
      .insert({
        sme_id: smeId,
        customer_email,
        project_name,
        project_description,
        total_amount,
        deposit_due_date: deposit_due_date || null,
        status: 'draft',
        invite_token: inviteToken,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (escrowError) throw new Error(`Database error: ${escrowError.message}`);

    // Create milestones
    const milestonesData = milestones.map((m, index) => ({
      escrow_id: escrow.id,
      title: m.title,
      description: m.description,
      amount: (parseFloat(m.percentage) / 100) * parseFloat(total_amount),
      percentage: parseFloat(m.percentage),
      order_index: index + 1,
      status: 'pending'
    }));

    const { error: milestonesError } = await supabaseAdmin
      .from('escrow_milestones')
      .insert(milestonesData);

    if (milestonesError) throw new Error(`Milestones error: ${milestonesError.message}`);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: escrow.id,
      user_id: smeId,
      action_type: 'escrow_created',
      description: `Escrow project "${project_name}" created`,
      metadata: { milestone_count: milestones.length }
    });

    logger.info(`Escrow created: ${escrow.id}`);

    res.status(201).json({
      success: true,
      message: 'Escrow project created successfully',
      escrow: {
        id: escrow.id,
        project_name: escrow.project_name,
        total_amount: escrow.total_amount,
        status: escrow.status,
        invite_token: inviteToken,
        created_at: escrow.created_at
      }
    });

  } catch (error) {
    logger.error('Escrow creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create escrow',
      message: error.message
    });
  }
});

// ==================== SEND INVITE ====================
// POST /api/escrow/:id/invite
router.post('/:id/invite', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const smeId = req.user.id;

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get escrow
    const { data: escrow, error: fetchError } = await supabaseAdmin
      .from('escrows')
      .select('*')
      .eq('id', id)
      .eq('sme_id', smeId)
      .single();

    if (fetchError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    // Update status to invited
    const { error: updateError } = await supabaseAdmin
      .from('escrows')
      .update({
        status: 'invited',
        invite_sent_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: id,
      user_id: smeId,
      action_type: 'invite_sent',
      description: `Invite sent to ${escrow.customer_email}`,
      metadata: { customer_email: escrow.customer_email }
    });

    // Invite link with correct format
    const inviteLink = `${process.env.FRONTEND_URL}/escrow/accept/${escrow.invite_token}`;

    logger.info(`Invite sent for escrow ${id} to ${escrow.customer_email}`);

    res.json({
      success: true,
      message: 'Invite sent successfully',
      invite_link: inviteLink
    });

  } catch (error) {
    logger.error('Failed to send invite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send invite',
      message: error.message
    });
  }
});

// ==================== GET ESCROW BY TOKEN (NO AUTH) ====================
// GET /api/escrow/token/:token - Get escrow by invite token (no auth required for viewing)
router.get('/token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    logger.info(`Fetching escrow by token: ${token.substring(0, 10)}...`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    const { data: escrow, error } = await supabaseAdmin
      .from('escrows')
      .select(`
        id,
        project_name,
        project_description,
        total_amount,
        customer_email,
        status,
        invite_token,
        created_at,
        escrow_milestones (
          id,
          title,
          description,
          amount,
          percentage,
          order_index
        )
      `)
      .eq('invite_token', token)
      .single();

    if (error || !escrow) {
      logger.warn(`Escrow not found for token: ${token.substring(0, 10)}...`);
      return res.status(404).json({ 
        success: false, 
        error: 'Invitation not found or expired',
        details: error?.message
      });
    }

    logger.info(`Found escrow: ${escrow.id} for token`);

    res.json({
      success: true,
      escrow: escrow
    });

  } catch (error) {
    logger.error('Failed to get escrow by token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invitation',
      message: error.message
    });
  }
});

// ==================== GET PENDING INVITES ====================
// GET /api/escrow/invites - Get pending invites for current user
router.get('/invites', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    logger.info(`Fetching pending invites for: ${userEmail}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // ✅ FIXED: Query for invites where customer_email matches AND customer hasn't accepted yet
    const { data: invites, error } = await supabaseAdmin
      .from('escrows')
      .select('id, project_name, project_description, total_amount, status, invite_token, created_at')
      .eq('customer_email', userEmail)
      .is('customer_id', null)
      .in('status', ['draft', 'invited']) // ✅ Include both draft and invited status
      .order('created_at', { ascending: false });

    if (error) throw error;

    logger.info(`Found ${invites?.length || 0} pending invites for ${userEmail}`);

    res.json({
      success: true,
      invites: invites || []
    });

  } catch (error) {
    logger.error('Error fetching invites:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invites',
      message: error.message
    });
  }
});

// ==================== GET ESCROW DETAILS ====================
// GET /api/escrow/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get escrow with milestones
    const { data: escrow, error: escrowError } = await supabaseAdmin
      .from('escrows')
      .select('*')
      .eq('id', id)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    // Check access
    if (escrow.sme_id !== userId && escrow.customer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get milestones
    const { data: milestones } = await supabaseAdmin
      .from('escrow_milestones')
      .select('*')
      .eq('escrow_id', id)
      .order('order_index', { ascending: true });

    // Get activities
    const { data: activities } = await supabaseAdmin
      .from('escrow_activities')
      .select('*')
      .eq('escrow_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      escrow: {
        ...escrow,
        milestones: milestones || [],
        recent_activities: activities || []
      }
    });

  } catch (error) {
    logger.error('Failed to get escrow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch escrow'
    });
  }
});

// ==================== LIST ESCROWS ====================
// GET /api/escrow
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email; // ✅ Get user email
    const { role = 'sme', status } = req.query;

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    let query = supabaseAdmin
      .from('escrows')
      .select('*, escrow_milestones(count)')
      .order('created_at', { ascending: false });

    if (role === 'sme') {
      query = query.eq('sme_id', userId);
    } else if (role === 'customer') {
      // ✅ FIXED: Query by customer_id OR customer_email
      query = query.or(`customer_id.eq.${userId},customer_email.eq.${userEmail}`);
    }

    if (status) query = query.eq('status', status);

    const { data: escrows, error } = await query;

    if (error) throw new Error(error.message);

    logger.info(`✅ Fetched ${escrows?.length || 0} escrows for role=${role}, user=${userId}`);

    res.json({
      success: true,
      escrows: escrows || []
    });

  } catch (error) {
    logger.error('Failed to list escrows:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch escrows'
    });
  }
});

// ==================== ACCEPT INVITE (Customer) ====================
// POST /api/escrow/accept/:token
router.post('/accept/:token', authenticate, async (req, res) => {
  try {
    const { token } = req.params;
    const customerId = req.user.id;
    const customerEmail = req.user.email;

    logger.info(`🎫 Customer ${customerId} (${customerEmail}) accepting invite: ${token.substring(0, 10)}...`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Find escrow by token
    const { data: escrow, error: fetchError } = await supabaseAdmin
      .from('escrows')
      .select('*')
      .eq('invite_token', token)
      .single();

    if (fetchError || !escrow) {
      logger.error('❌ Escrow not found for token');
      return res.status(404).json({ success: false, error: 'Invalid or expired invite' });
    }

    // ✅ Verify customer email matches (security check)
    if (escrow.customer_email !== customerEmail) {
      logger.error(`❌ Email mismatch: escrow=${escrow.customer_email}, user=${customerEmail}`);
      return res.status(403).json({ 
        success: false, 
        error: 'This invitation was sent to a different email address' 
      });
    }

    // Check if already accepted
    if (escrow.status === 'pending_deposit' || escrow.status === 'active') {
      return res.status(400).json({ success: false, error: 'Invite already accepted' });
    }

    // ✅ FIXED: Update escrow with customer_id and change status
    const { data: updatedEscrow, error: updateError } = await supabaseAdmin
      .from('escrows')
      .update({
        customer_id: customerId,
        status: 'pending_deposit', // ✅ Change from 'draft' to 'pending_deposit'
        invite_accepted_at: new Date().toISOString()
      })
      .eq('id', escrow.id)
      .select()
      .single();

    if (updateError) {
      logger.error('❌ Failed to update escrow:', updateError);
      throw new Error(updateError.message);
    }

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: escrow.id,
      user_id: customerId,
      action_type: 'invite_accepted',
      description: 'Customer accepted escrow invite'
    });

    logger.info(`✅ Escrow ${escrow.id} accepted by customer ${customerId}`);

    res.json({
      success: true,
      message: 'Invite accepted successfully! You can now make your deposit.',
      escrow: updatedEscrow
    });

  } catch (error) {
    logger.error('Failed to accept invite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept invite',
      message: error.message
    });
  }
});

// ==================== DEPOSIT FUNDS (Customer) ====================
// POST /api/escrow/:id/deposit
router.post('/:id/deposit', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method_id } = req.body;
    const customerId = req.user.id;

    logger.info(`Customer ${customerId} depositing funds to escrow ${id}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    // Get escrow
    const { data: escrow, error: fetchError } = await supabaseAdmin
      .from('escrows')
      .select('*')
      .eq('id', id)
      .eq('customer_id', customerId)
      .single();

    if (fetchError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    if (escrow.status !== 'pending_deposit') {
      return res.status(400).json({ success: false, error: 'Escrow not ready for deposit' });
    }

    // TODO: Process payment with Stripe
    // For now, just mark as deposited

    // Update escrow
    const { error: updateError } = await supabaseAdmin
      .from('escrows')
      .update({
        status: 'active',
        deposited_amount: escrow.total_amount,
        deposited_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Log activity
    await supabaseAdmin.from('escrow_activities').insert({
      escrow_id: id,
      user_id: customerId,
      action_type: 'funds_deposited',
      description: `$${escrow.total_amount} deposited`,
      metadata: { amount: escrow.total_amount }
    });

    logger.info(`Funds deposited for escrow ${id}`);

    res.json({
      success: true,
      message: 'Funds deposited successfully',
      escrow: {
        id: escrow.id,
        status: 'active',
        deposited_amount: escrow.total_amount
      }
    });

  } catch (error) {
    logger.error('Failed to deposit funds:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deposit funds',
      message: error.message
    });
  }
});

export default router;
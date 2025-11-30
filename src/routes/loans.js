/**
 * Loans API Routes - Updated for existing table structure
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { blockchainService } from '../services/blockchain.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('LoansAPI');

// POST /api/loans/request
router.post('/request', authenticate, async (req, res) => {
  try {
    const { asset_id, amount_requested, interest_rate, term_months, purpose, collateral_description } = req.body;
    const userId = req.user.id;

    logger.info(`User ${userId} requesting loan: $${amount_requested} for ${term_months} months`);
    logger.info(`Request body:`, { asset_id, amount_requested, interest_rate, term_months, purpose });

    // Validate required fields
    if (!asset_id) {
      return res.status(400).json({
        success: false,
        error: 'asset_id is required'
      });
    }

    if (!amount_requested || amount_requested <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amount_requested must be a positive number'
      });
    }

    if (!term_months || term_months <= 0) {
      return res.status(400).json({
        success: false,
        error: 'term_months must be a positive number'
      });
    }

    // Parse to ensure we have numbers
    const parsedAmount = parseFloat(amount_requested);
    const parsedInterestRate = parseFloat(interest_rate) || 10;
    const parsedTermMonths = parseInt(term_months);
    const parsedAssetId = parseInt(asset_id);

    if (isNaN(parsedAmount) || isNaN(parsedTermMonths) || isNaN(parsedAssetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid numeric values provided'
      });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    // Calculate due date based on months
    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + parsedTermMonths);

    // Create loan in database with correct field names
    const { data: loan, error: dbError } = await supabaseAdmin
      .from('loans')
      .insert({
        sme_id: userId,
        asset_id: parsedAssetId,
        // Old columns (NOT NULL - required)
        amount: parsedAmount,                  // NOT NULL column
        term: parsedTermMonths,                // NOT NULL column (same as term_months)
        // New columns (nullable - optional but we set them anyway)
        amount_requested: parsedAmount,        // Nullable column
        term_months: parsedTermMonths,         // Nullable column
        // Other fields
        interest_rate: parsedInterestRate,
        ltv: 80,
        status: 'requested',
        purpose: purpose || collateral_description || 'Asset financing',
        collateral_description: collateral_description || `Asset #${parsedAssetId}`,
        due_date: dueDate.toISOString(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (dbError) {
      logger.error('Database error creating loan:', dbError);
      throw new Error(`Database error: ${dbError.message}`);
    }

    logger.info(`Loan ${loan.id} created successfully in database`);

    // Request loan on blockchain (async, mock mode)
    if (parsedAssetId) {
      blockchainService.requestLoan({
        assetId: parsedAssetId,
        amount: parsedAmount,
        interestRate: parsedInterestRate,
        termDays: parsedTermMonths * 30, // Convert months to days for blockchain
        borrowerEmail: req.user.email
      })
        .then(() => {
          logger.info(`Loan ${loan.id} blockchain request completed (mock)`);
        })
        .catch(error => {
          logger.error(`Blockchain loan request failed for loan ${loan.id}:`, error);
        });
    }

    res.status(201).json({
      success: true,
      message: 'Loan request submitted successfully',
      loan: {
        id: loan.id,
        amount_requested: loan.amount_requested,
        interest_rate: loan.interest_rate,
        term_months: loan.term_months,
        asset_id: loan.asset_id,
        status: loan.status,
        due_date: loan.due_date,
        created_at: loan.created_at
      }
    });

  } catch (error) {
    logger.error('Loan request failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to request loan',
      message: error.message
    });
  }
});

// GET /api/loans - List loans
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { role = 'borrower', status } = req.query;

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    let query = supabaseAdmin
      .from('loans')
      .select('*')
      .order('created_at', { ascending: false });

    if (role === 'borrower') {
      query = query.eq('sme_id', userId);
    } else if (role === 'lender') {
      query = query.or(`lender_id.eq.${userId},status.eq.requested`);
    }

    if (status) query = query.eq('status', status);

    const { data: loans, error } = await query;

    if (error) throw new Error(error.message);

    res.json({ success: true, loans: loans || [] });

  } catch (error) {
    logger.error('Failed to list loans:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch loans' });
  }
});

// GET /api/loans/:loanId - SME can view their own loan details
router.get('/:loanId', authenticate, async (req, res) => {
  try {
    const { loanId } = req.params;
    const userId = req.user.id;

    logger.info(`User ${userId} fetching loan ${loanId}`);

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    // Get the loan
    const { data: loan, error: loanError } = await supabaseAdmin
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (loanError) {
      logger.error('Loan fetch error:', loanError);
      throw new Error(loanError.message);
    }

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    // Check if user owns this loan (or is the lender)
    if (loan.sme_id !== userId && loan.lender_id !== userId) {
      logger.warn(`Access denied: User ${userId} tried to access loan owned by ${loan.sme_id}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied - you can only view your own loans'
      });
    }

    // Get asset details if asset_id exists
    let asset = null;
    if (loan.asset_id) {
      console.log('🔍 Fetching asset for asset_id:', loan.asset_id);
      const { data: assetData, error: assetError } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', loan.asset_id)
        .single();
      
      if (assetError) {
        console.error('❌ Asset fetch error:', assetError);
      } else {
        console.log('✅ Asset found:', assetData?.asset_name || assetData?.type);
      }
      asset = assetData;
    }

    // Format response
    const loanDetails = {
      loan_id: loan.id,
      status: loan.status,
      amount_requested: loan.amount_requested || loan.amount,
      interest_rate: loan.interest_rate,
      term_months: loan.term_months || loan.term,
      asset_id: loan.asset_id,
      asset_type: asset?.type || null,
      asset_name: asset?.asset_name || null,
      asset_value: asset?.value || null,
      purpose: loan.purpose,
      created_at: loan.created_at,
      reviewed_at: loan.reviewed_at,
      lender_notes: loan.lender_notes,
      approval_conditions: loan.approval_conditions,
      due_date: loan.due_date,
      sme_name: req.user.name || req.user.email
    };

    logger.info(`✅ Loan ${loanId} details fetched for user ${userId}`);

    res.json({
      success: true,
      loan: loanDetails
    });

  } catch (error) {
    logger.error('Error fetching loan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch loan details',
      message: error.message
    });
  }
});

// POST /api/loans/:id/fund
router.post('/:id/fund', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const lenderId = req.user.id;

    logger.info(`Lender ${lenderId} funding loan ${id}`);

    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    const { data: loan, error: loanError } = await supabaseAdmin
      .from('loans')
      .select('*')
      .eq('id', id)
      .single();

    if (loanError || !loan) {
      return res.status(404).json({ success: false, error: 'Loan not found' });
    }

    if (loan.status !== 'requested' && loan.status !== 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Loan is not available for funding',
        current_status: loan.status
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('loans')
      .update({
        lender_id: lenderId,
        status: 'funded',
        funded_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Mock blockchain funding
    blockchainService.fundLoan({
      loanId: id,
      lenderEmail: req.user.email
    })
      .then(() => logger.info(`Loan ${id} funded on blockchain (mock)`))
      .catch(error => logger.error(`Blockchain funding failed for loan ${id}:`, error));

    res.json({
      success: true,
      message: 'Loan funded successfully',
      loan: { id: loan.id, status: 'funded', funded_at: new Date().toISOString() }
    });

  } catch (error) {
    logger.error('Loan funding failed:', error);
    res.status(500).json({ success: false, error: 'Failed to fund loan', message: error.message });
  }
});

export default router;
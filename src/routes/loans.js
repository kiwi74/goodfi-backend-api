import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware to authenticate requests
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  supabase.auth.getUser(token)
    .then(({ data: { user }, error }) => {
      if (error || !user) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = user;
      next();
    })
    .catch(err => {
      console.error('Auth error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    });
};

// POST /api/loans/request - Create a new loan request
router.post('/request', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { asset_id, amount, term_months, purpose } = req.body;

    // Validate required fields
    if (!asset_id || !amount || !term_months) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['asset_id', 'amount', 'term_months']
      });
    }

    // Verify the asset belongs to the user
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', asset_id)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      return res.status(404).json({ error: 'Asset not found or does not belong to you' });
    }

    // FIXED: Removed verification check to restore create-asset → request-loan workflow
    // Assets can now request loans immediately after creation
    // Verification happens separately via the "Verify" button in SME Assets page

    // Create the loan
    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .insert({
        sme_id: userId,
        asset_id: asset_id,
        amount_requested: amount,
        amount: amount,
        term_months: term_months,
        term: term_months,
        purpose: purpose || null,
        status: 'requested',
        interest_rate: 10, // Default rate, can be adjusted
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (loanError) {
      console.error('Error creating loan:', loanError);
      return res.status(500).json({ error: 'Failed to create loan request' });
    }

    res.json({
      success: true,
      message: 'Loan request created successfully',
      loan
    });

  } catch (error) {
    console.error('Error in loan request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/loans/sme/my-loans - Get all loans for the authenticated SME (NEW ENDPOINT)
router.get('/sme/my-loans', authenticateToken, async (req, res) => {
  try {
    const smeId = req.user.id;

    // Fetch all loans for this SME
    const { data: loans, error } = await supabase
      .from('loans')
      .select('*')
      .eq('sme_id', smeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching SME loans:', error);
      return res.status(500).json({ error: 'Failed to fetch loans' });
    }

    // Fetch asset details for each loan
    const loansWithAssets = await Promise.all(
      loans.map(async (loan) => {
        if (loan.asset_id) {
          const { data: asset } = await supabase
            .from('assets')
            .select('*')
            .eq('id', loan.asset_id)
            .single();
          return { ...loan, asset };
        }
        return loan;
      })
    );

    res.json({ success: true, loans: loansWithAssets });
  } catch (error) {
    console.error('Error fetching SME loans:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/loans/:loanId - Get specific loan details (for SME viewing their own loan)
router.get('/:loanId', authenticateToken, async (req, res) => {
  try {
    const { loanId } = req.params;
    const userId = req.user.id;

    // Fetch the loan
    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (loanError || !loan) {
      console.error('Error fetching loan:', loanError);
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Verify ownership
    if (loan.sme_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch asset details if exists
    let asset = null;
    if (loan.asset_id) {
      const { data: assetData } = await supabase
        .from('assets')
        .select('*')
        .eq('id', loan.asset_id)
        .single();
      asset = assetData;
    }

    // Format response
    const formattedLoan = {
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
      due_date: loan.due_date
    };

    res.json({ success: true, loan: formattedLoan });

  } catch (error) {
    console.error('Error fetching loan details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
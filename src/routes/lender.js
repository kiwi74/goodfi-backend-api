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

  // Verify the token with Supabase
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

// GET /api/lender/stats - Get lender dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Verify user is a lender
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile || profile.role !== 'lender') {
      return res.status(403).json({ error: 'Access denied - lender role required' });
    }

    // Get all loans statistics
    const { data: allLoans, error: loansError } = await supabase
      .from('loans')
      .select('status, amount_requested, amount');

    if (loansError) {
      console.error('Error fetching loans:', loansError);
      return res.status(500).json({ error: 'Failed to fetch statistics' });
    }

    // Calculate statistics
    const stats = {
      total_loans: allLoans.length,
      pending_approval: allLoans.filter(l => l.status === 'requested').length,
      approved_loans: allLoans.filter(l => l.status === 'approved').length,
      active_loans: allLoans.filter(l => l.status === 'active' || l.status === 'funded').length,
      rejected_loans: allLoans.filter(l => l.status === 'rejected').length,
      funded_loans: allLoans.filter(l => l.status === 'funded').length,
      total_amount_deployed: allLoans
        .filter(l => l.status === 'active' || l.status === 'funded')
        .reduce((sum, loan) => sum + parseFloat(loan.amount || loan.amount_requested || 0), 0),
      active_amount: allLoans
        .filter(l => l.status === 'active')
        .reduce((sum, loan) => sum + parseFloat(loan.amount || loan.amount_requested || 0), 0)
    };

    res.json({ success: true, stats });

  } catch (error) {
    console.error('Error fetching lender stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/lender/all-loans - Get all loan applications for lender review
router.get('/all-loans', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Verify user is a lender
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile || profile.role !== 'lender') {
      return res.status(403).json({ error: 'Access denied - lender role required' });
    }

    // Fetch all loans first
    const { data: loans, error: loansError } = await supabase
      .from('loans')
      .select('*')
      .order('created_at', { ascending: false });

    if (loansError) {
      console.error('Error fetching loans:', loansError);
      return res.status(500).json({ error: 'Failed to fetch loans' });
    }

    // Then fetch related data for each loan
    const formattedLoans = await Promise.all(loans.map(async (loan) => {
      // Fetch SME profile
      const { data: sme } = await supabase
        .from('profiles')
        .select('id, name, email, company_name, phone')
        .eq('id', loan.sme_id)
        .single();

      // Fetch asset if exists
      let asset = null;
      if (loan.asset_id) {
        const { data: assetData } = await supabase
          .from('assets')
          .select('id, type, asset_name, description, verification_status, verified_at')
          .eq('id', loan.asset_id)
          .single();
        asset = assetData;
      }

      return {
        loan_id: loan.id,
        status: loan.status,
        amount_requested: loan.amount_requested || loan.amount,
        interest_rate: loan.interest_rate,
        term_months: loan.term_months || loan.term,
        asset_id: loan.asset_id,
        asset_type: asset?.type || null,
        asset_name: asset?.asset_name || null,
        asset_description: asset?.description || null,
        verification_status: asset?.verification_status || null,
        verified_at: asset?.verified_at || null,
        sme_id: loan.sme_id,
        sme_name: sme?.name || null,
        sme_email: sme?.email || null,
        sme_phone: sme?.phone || null,
        created_at: loan.created_at,
        reviewed_at: loan.reviewed_at,
        lender_notes: loan.lender_notes,
        approval_conditions: loan.approval_conditions,
        due_date: loan.due_date,
        purpose: loan.purpose
      };
    }));

    res.json({ success: true, loans: formattedLoans });

  } catch (error) {
    console.error('Error fetching all loans:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/lender/loan/:id - Get specific loan details
router.get('/loan/:id', authenticateToken, async (req, res) => {
  try {
    const { id: loanId } = req.params;
    const userId = req.user.id;

    // Verify user is a lender
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile || profile.role !== 'lender') {
      return res.status(403).json({ error: 'Access denied - lender role required' });
    }

    // Fetch loan
    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (loanError || !loan) {
      console.error('Error fetching loan:', loanError);
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Fetch SME profile
    const { data: sme } = await supabase
      .from('profiles')
      .select('id, name, email, phone')
      .eq('id', loan.sme_id)
      .single();

    // Fetch asset if exists
    let asset = null;
    if (loan.asset_id) {
      const { data: assetData } = await supabase
        .from('assets')
        .select('id, type, asset_name, value, description, verification_status')
        .eq('id', loan.asset_id)
        .single();
      asset = assetData;
    }

    // Format the response
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
      sme_name: sme?.name || null,
      sme_email: sme?.email || null
    };

    res.json({ success: true, loan: formattedLoan });

  } catch (error) {
    console.error('Error fetching loan details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lender/loan/:id/approve - Approve a loan application
router.post('/loan/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id: loanId } = req.params;
    const { approval_conditions } = req.body;
    const userId = req.user.id;

    // Verify user is a lender
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile || profile.role !== 'lender') {
      return res.status(403).json({ error: 'Access denied - lender role required' });
    }

    // Update loan status to approved
    const { data: loan, error: updateError } = await supabase
      .from('loans')
      .update({
        status: 'approved',
        lender_id: userId,
        approval_conditions: approval_conditions || null,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', loanId)
      .select()
      .single();

    if (updateError) {
      console.error('Error approving loan:', updateError);
      return res.status(500).json({ error: 'Failed to approve loan' });
    }

    res.json({
      success: true,
      message: 'Loan approved successfully',
      loan
    });

  } catch (error) {
    console.error('Error in approve endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lender/loan/:id/reject - Reject a loan application
router.post('/loan/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id: loanId } = req.params;
    const { rejection_reason } = req.body;
    const userId = req.user.id;

    // Verify user is a lender
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile || profile.role !== 'lender') {
      return res.status(403).json({ error: 'Access denied - lender role required' });
    }

    // Update loan status to rejected
    const { data: loan, error: updateError } = await supabase
      .from('loans')
      .update({
        status: 'rejected',
        lender_id: userId,
        lender_notes: rejection_reason || null,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', loanId)
      .select()
      .single();

    if (updateError) {
      console.error('Error rejecting loan:', updateError);
      return res.status(500).json({ error: 'Failed to reject loan' });
    }

    res.json({
      success: true,
      message: 'Loan rejected',
      loan
    });

  } catch (error) {
    console.error('Error in reject endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
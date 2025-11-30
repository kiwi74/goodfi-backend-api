/**
 * GoodFi Verification & Lender Approval Routes
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      console.log('❌ Token validation failed:', error);
      throw error;
    }
    
    // Get user profile including role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      console.log('❌ Profile fetch failed:', profileError);
      throw profileError;
    }
    
    console.log('✅ Authenticated user:', profile.email, 'Role:', profile.role);
    req.user = profile;
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Middleware to check if user is a lender
const requireLenderRole = (req, res, next) => {
  console.log('🔍 Checking lender role for:', req.user.email, 'Role:', req.user.role);
  if (req.user.role !== 'lender' && req.user.role !== 'admin') {
    console.log('❌ Access denied - not a lender/admin');
    return res.status(403).json({ error: 'Lender access required' });
  }
  console.log('✅ Lender role verified');
  next();
};

// =====================================================
// VERIFICATION ENDPOINTS
// =====================================================

/**
 * POST /api/verification/verify-asset/:assetId
 * Trigger mock verification for an asset
 */
router.post('/verify-asset/:assetId', authenticateToken, async (req, res) => {
  try {
    const { assetId } = req.params;
    
    console.log('🔍 Verifying asset:', assetId);
    
    // Get asset details
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single();
    
    if (assetError || !asset) {
      console.log('❌ Asset not found:', assetId);
      return res.status(404).json({ error: 'Asset not found' });
    }
    
    // Check ownership
    if (asset.user_id !== req.user.id && req.user.role !== 'admin') {
      console.log('❌ Unauthorized access to asset');
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Mock verification logic
    const verificationData = await performMockVerification(asset);
    
    console.log('✅ Verification result:', verificationData.status);
    
    // Update asset with verification results
    const { data: updatedAsset, error: updateError } = await supabase
      .from('assets')
      .update({
        verification_status: verificationData.status,
        verification_method: 'mock_oracle',
        verification_data: verificationData.data,
        verified_at: verificationData.status === 'verified' ? new Date().toISOString() : null,
        verified_by: 'Mock Oracle Service'
      })
      .eq('id', assetId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    // Log verification attempt
    await supabase.from('verification_logs').insert({
      asset_id: assetId,
      verification_method: 'mock_oracle',
      status: verificationData.status === 'verified' ? 'success' : 'failed',
      verification_data: verificationData.data,
      error_message: verificationData.error
    });
    
    res.json({
      success: true,
      asset: updatedAsset,
      verification: verificationData
    });
    
  } catch (error) {
    console.error('❌ Verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/verification/logs/:assetId
 * Get verification history for an asset
 */
router.get('/logs/:assetId', authenticateToken, async (req, res) => {
  try {
    const { assetId } = req.params;
    
    const { data: logs, error } = await supabase
      .from('verification_logs')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ logs });
    
  } catch (error) {
    console.error('❌ Error fetching verification logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// LENDER DASHBOARD ENDPOINTS
// =====================================================

/**
 * GET /api/lender/pending-loans
 * Get all loans pending lender approval
 */
router.get('/pending-loans', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    console.log('📋 Fetching pending loans');
    
    // Query loans with status 'requested' (pending approval)
    const { data: loans, error } = await supabase
      .from('loans')
      .select(`
        *,
        profiles:sme_id (
          id,
          name,
          email,
          phone
        ),
        assets:asset_id (
          id,
          type,
          asset_name,
          description,
          value,
          verification_status,
          verified_at
        )
      `)
      .eq('status', 'requested')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    console.log(`✅ Found ${loans?.length || 0} pending loans`);
    
    res.json({ loans: loans || [] });
    
  } catch (error) {
    console.error('❌ Error fetching pending loans:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/lender/all-loans
 * Get all loans (for lender dashboard overview)
 */
router.get('/all-loans', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    const { status } = req.query;
    
    console.log('📋 Fetching all loans', status ? `with status: ${status}` : '');
    
    let query = supabase
      .from('loans')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: loans, error } = await query;
    
    if (error) {
      console.error('❌ Query error:', error);
      throw error;
    }
    
    console.log(`✅ Found ${loans?.length || 0} raw loans`);
    
    // Get SME and asset details separately for each loan
    const loansWithDetails = await Promise.all((loans || []).map(async (loan) => {
      // Get SME profile
      console.log('🔍 Fetching profile for sme_id:', loan.sme_id);
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('name, phone')
        .eq('id', loan.sme_id)
        .single();
      
      if (profileError) {
        console.error('❌ Profile fetch error for', loan.sme_id, ':', profileError);
      } else {
        console.log('✅ Profile found:', profile);
      }
      
      // Get asset details if asset_id exists
      let asset = null;
      if (loan.asset_id) {
        console.log('🔍 Fetching asset for asset_id:', loan.asset_id);
        const { data: assetData, error: assetError } = await supabase
          .from('assets')
          .select('*')
          .eq('id', loan.asset_id)
          .single();
        
        if (assetError) {
          console.error('❌ Asset fetch error for', loan.asset_id, ':', assetError);
        } else {
          console.log('✅ Asset found:', assetData?.asset_name || assetData?.type);
        }
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
        sme_name: profile?.name || 'Unknown',
        sme_email: null,
        sme_phone: profile?.phone || null,
        created_at: loan.created_at,
        reviewed_at: loan.reviewed_at,
        lender_notes: loan.lender_notes,
        approval_conditions: loan.approval_conditions,
        due_date: loan.due_date,
        purpose: loan.purpose
      };
    }));
    
    console.log(`✅ Transformed ${loansWithDetails.length} loans with details`);
    
    res.json({ loans: loansWithDetails });
    
  } catch (error) {
    console.error('❌ Error fetching loans:', error.message, error.details);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/lender/loan/:loanId
 * Get detailed information about a specific loan
 */
router.get('/loan/:loanId', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    const { loanId } = req.params;
    
    console.log('🔍 Fetching loan details for:', loanId);
    
    const { data: loan, error } = await supabase
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();
    
    if (error) {
      console.log('❌ Loan fetch error:', error);
      throw error;
    }
    
    if (!loan) {
      console.log('❌ Loan not found:', loanId);
      return res.status(404).json({ error: 'Loan not found' });
    }
    
    // Get SME profile
    console.log('🔍 Fetching profile for sme_id:', loan.sme_id);
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, phone')
      .eq('id', loan.sme_id)
      .single();
    
    if (profileError) {
      console.error('❌ Profile fetch error:', profileError);
    } else {
      console.log('✅ Profile found:', profile);
    }
    
    // Get asset details if asset_id exists
    let asset = null;
    if (loan.asset_id) {
      console.log('🔍 Fetching asset for asset_id:', loan.asset_id);
      const { data: assetData, error: assetError } = await supabase
        .from('assets')
        .select('*')
        .eq('id', loan.asset_id)
        .single();
      
      if (assetError) {
        console.error('❌ Asset fetch error:', assetError);
      } else {
        console.log('✅ Asset found:', assetData?.asset_name);
      }
      asset = assetData;
    }
    
    // Get status history
    const { data: history, error: historyError } = await supabase
      .from('loan_status_history')
      .select('*')
      .eq('loan_id', loanId)
      .order('created_at', { ascending: false });
    
    if (historyError) console.log('⚠️ History fetch error:', historyError);
    
    // Transform to match expected format
    const transformedLoan = {
      loan_id: loan.id,
      status: loan.status,
      amount_requested: loan.amount_requested || loan.amount,
      interest_rate: loan.interest_rate,
      term_months: loan.term_months || loan.term,
      purpose: loan.purpose,
      created_at: loan.created_at,
      reviewed_at: loan.reviewed_at,
      lender_notes: loan.lender_notes,
      approval_conditions: loan.approval_conditions,
      sme_id: loan.sme_id,
      sme_name: profile?.name || 'Unknown',
      sme_email: null,
      sme_phone: profile?.phone || null,
      asset_id: loan.asset_id,
      asset_type: asset?.type || null,
      asset_name: asset?.asset_name || null,
      asset_description: asset?.description || null,
      asset_value: asset?.value || 0,
      verification_status: asset?.verification_status || null,
      verification_data: asset?.verification_data || null,
      verified_at: asset?.verified_at || null,
      status_history: history || []
    };
    
    console.log('✅ Loan details fetched successfully');
    
    res.json({ loan: transformedLoan });
    
  } catch (error) {
    console.error('❌ Error fetching loan details:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lender/approve-loan/:loanId
 * Approve a loan request
 */
router.post('/approve-loan/:loanId', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    const { loanId } = req.params;
    const { notes, conditions } = req.body;
    
    console.log('✅ Approving loan:', loanId);
    
    // Get current loan status
    const { data: currentLoan, error: fetchError } = await supabase
      .from('loans')
      .select('status')
      .eq('id', loanId)
      .single();
    
    if (fetchError) throw fetchError;
    
    if (currentLoan.status !== 'requested') {
      console.log('❌ Loan not in requested status:', currentLoan.status);
      return res.status(400).json({ 
        error: 'Loan is not pending approval',
        currentStatus: currentLoan.status 
      });
    }
    
    // Update loan to approved
    const { data: updatedLoan, error: updateError } = await supabase
      .from('loans')
      .update({
        status: 'approved',
        lender_id: req.user.id,
        reviewed_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        lender_notes: notes,
        approval_conditions: conditions
      })
      .eq('id', loanId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    // Log status change
    await supabase.from('loan_status_history').insert({
      loan_id: loanId,
      old_status: 'requested',
      new_status: 'approved',
      changed_by: req.user.id,
      notes: notes
    });
    
    console.log('✅ Loan approved successfully');
    
    res.json({
      success: true,
      loan: updatedLoan,
      message: 'Loan approved successfully'
    });
    
  } catch (error) {
    console.error('❌ Error approving loan:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lender/reject-loan/:loanId
 * Reject a loan request
 */
router.post('/reject-loan/:loanId', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    const { loanId } = req.params;
    const { reason } = req.body;
    
    console.log('❌ Rejecting loan:', loanId);
    
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }
    
    // Get current loan status
    const { data: currentLoan, error: fetchError } = await supabase
      .from('loans')
      .select('status')
      .eq('id', loanId)
      .single();
    
    if (fetchError) throw fetchError;
    
    if (currentLoan.status !== 'requested') {
      console.log('❌ Loan not in requested status:', currentLoan.status);
      return res.status(400).json({ 
        error: 'Loan is not pending approval',
        currentStatus: currentLoan.status 
      });
    }
    
    // Update loan to rejected
    const { data: updatedLoan, error: updateError } = await supabase
      .from('loans')
      .update({
        status: 'rejected',
        lender_id: req.user.id,
        reviewed_at: new Date().toISOString(),
        lender_notes: reason
      })
      .eq('id', loanId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    // Log status change
    await supabase.from('loan_status_history').insert({
      loan_id: loanId,
      old_status: 'requested',
      new_status: 'rejected',
      changed_by: req.user.id,
      notes: reason
    });
    
    console.log('✅ Loan rejected successfully');
    
    res.json({
      success: true,
      loan: updatedLoan,
      message: 'Loan rejected'
    });
    
  } catch (error) {
    console.error('❌ Error rejecting loan:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/lender/stats
 * Get statistics for lender dashboard
 */
router.get('/stats', authenticateToken, requireLenderRole, async (req, res) => {
  try {
    console.log('📊 Fetching lender stats');
    
    // Get counts by status
    const { data: loans, error: loansError } = await supabase
      .from('loans')
      .select('status, amount_requested, amount');
    
    if (loansError) throw loansError;
    
    const stats = {
      total_loans: loans.length,
      pending_approval: loans.filter(l => l.status === 'requested').length,
      approved_loans: loans.filter(l => l.status === 'approved').length,
      active_loans: loans.filter(l => l.status === 'active').length,
      rejected_loans: loans.filter(l => l.status === 'rejected').length,
      funded_loans: loans.filter(l => l.status === 'funded').length
    };
    
    stats.total_amount_deployed = loans.reduce((sum, loan) => {
      const amount = parseFloat(loan.amount_requested || loan.amount || 0);
      return sum + amount;
    }, 0);
    
    stats.active_amount = loans
      .filter(l => l.status === 'active')
      .reduce((sum, loan) => {
        const amount = parseFloat(loan.amount_requested || loan.amount || 0);
        return sum + amount;
      }, 0);
    
    console.log('✅ Stats calculated:', stats);
    
    res.json({ stats });
    
  } catch (error) {
    console.error('❌ Error fetching lender stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Mock verification logic
 */
async function performMockVerification(asset) {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Mock verification rules based on asset type
  const verificationRules = {
    deposit: {
      minValue: 1000,
      maxValue: 1000000,
      requiredFields: ['description', 'value']
    },
    purchase_order: {
      minValue: 5000,
      maxValue: 5000000,
      requiredFields: ['description', 'value']
    },
    invoice: {
      minValue: 1000,
      maxValue: 2000000,
      requiredFields: ['description', 'value']
    }
  };
  
  const rules = verificationRules[asset.type] || verificationRules.deposit;
  
  // Check basic validation
  const checks = {
    hasRequiredFields: rules.requiredFields.every(field => asset[field]),
    valueInRange: asset.value >= rules.minValue && asset.value <= rules.maxValue,
    hasValidDescription: asset.description && asset.description.length >= 10,
    timestamp: new Date().toISOString()
  };
  
  // Determine if verification passed
  const passed = Object.values(checks).every(check => 
    typeof check === 'boolean' ? check : true
  );
  
  // Generate verification data
  const verificationData = {
    checks,
    verifiedAmount: asset.value,
    confidence: passed ? 0.95 : 0.45,
    riskScore: passed ? 'low' : 'high',
    verificationMethod: 'mock_oracle',
    dataSource: `Mock ${asset.type} verification`,
    verifiedAt: new Date().toISOString()
  };
  
  return {
    status: passed ? 'verified' : 'verification_failed',
    data: verificationData,
    error: passed ? null : 'Asset did not meet verification criteria'
  };
}

export default router;
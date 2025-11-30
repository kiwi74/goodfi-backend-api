/**
 * Assets API Routes
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateAssetCreation } from '../middleware/validation.js';
import { supabaseAdmin } from '../config/supabase.js';
import { blockchainService } from '../services/blockchain.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('AssetsAPI');

// POST /api/assets/create
router.post('/create', authenticate, validateAssetCreation, async (req, res) => {
  try {
    const { type, value, description, asset_name, counterparty_email, document_url } = req.body;
    const userId = req.user.id;

    logger.info(`User ${userId} creating ${type} asset: "${asset_name}" worth $${value}`);

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured',
        message: 'Please configure SUPABASE_SERVICE_KEY'
      });
    }

    // Create asset in database
    const { data: asset, error: dbError } = await supabaseAdmin
      .from('assets')
      .insert({
        user_id: userId,
        type,
        value,
        description,
        asset_name: asset_name || null,
        counterparty_email,
        document_url,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (dbError) throw new Error(`Database error: ${dbError.message}`);

    logger.info(`Asset created in database: ID ${asset.id}, Name: "${asset.asset_name}"`);

    // Tokenize on blockchain (async - don't wait)
    blockchainService.createAsset({
      type,
      ownerEmail: req.user.email,
      counterpartyEmail: counterparty_email,
      value,
      documentHash: null
    })
      .then(async (blockchainResult) => {
        await supabaseAdmin
          .from('assets')
          .update({
            blockchain_asset_id: blockchainResult.assetId,
            transaction_hash: blockchainResult.transactionHash,
            block_number: blockchainResult.blockNumber
          })
          .eq('id', asset.id);

        logger.info(`Asset ${asset.id} tokenized: blockchain ID ${blockchainResult.assetId}`);

        await blockchainService.notifyOracleForVerification(blockchainResult.assetId);
      })
      .catch(error => {
        logger.error(`Blockchain failed for asset ${asset.id}:`, error);
        supabaseAdmin
          .from('assets')
          .update({ status: 'error', error_message: error.message })
          .eq('id', asset.id);
      });

    res.status(201).json({
      success: true,
      message: 'Asset created successfully and being verified',
      asset: {
        id: asset.id,
        type: asset.type,
        value: asset.value,
        status: asset.status,
        asset_name: asset.asset_name,
        description: asset.description,
        created_at: asset.created_at
      }
    });

  } catch (error) {
    logger.error('Asset creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create asset',
      message: error.message
    });
  }
});

// GET /api/assets/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    const { data: asset, error } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    if (!asset) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found'
      });
    }

    if (asset.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    let blockchainData = null;
    if (asset.blockchain_asset_id) {
      try {
        blockchainData = await blockchainService.getAsset(asset.blockchain_asset_id);
      } catch (error) {
        logger.warn(`Failed to fetch blockchain data for asset ${id}`);
      }
    }

    res.json({
      success: true,
      asset: {
        ...asset,
        blockchain_status: blockchainData?.status || 'pending',
        blockchain_verified: blockchainData?.verifiedAt ? true : false
      }
    });

  } catch (error) {
    logger.error('Failed to get asset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch asset',
      message: error.message
    });
  }
});

// GET /api/assets
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, type, limit = 50, offset = 0 } = req.query;

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    let query = supabaseAdmin
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);

    const { data: assets, error, count } = await query;

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      assets: assets || [],
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    logger.error('Failed to list assets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assets',
      message: error.message
    });
  }
});

// ADMIN: Manually verify asset (for testing)
router.post('/:id/verify', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    const { error } = await supabaseAdmin
      .from('assets')
      .update({ status: 'verified' })
      .eq('id', id);

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      message: 'Asset verified successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to verify asset',
      message: error.message
    });
  }
});

export default router;
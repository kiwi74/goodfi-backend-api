/**
 * Blockchain Service - Optional Mode
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('BlockchainService');

class BlockchainService {
  constructor() {
    this.initialized = false;
    this.mockMode = true;
  }

  async initialize() {
    logger.info('Blockchain service running in MOCK mode (no gas needed)');
    this.initialized = true;
    this.mockMode = true;
  }

  async createAsset({ type, ownerEmail, value }) {
    logger.info(`[MOCK] Creating asset: type=${type}, value=${value}`);
    
    // Simulate blockchain delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return mock blockchain data
    const mockAssetId = Math.floor(Math.random() * 10000);
    const mockTxHash = '0x' + Math.random().toString(16).substr(2, 64);
    
    logger.info(`[MOCK] Asset created: ID ${mockAssetId}`);
    
    return {
      success: true,
      assetId: mockAssetId.toString(),
      transactionHash: mockTxHash,
      blockNumber: 12345678
    };
  }

  async requestLoan({ assetId, amount, interestRate, termDays }) {
    logger.info(`[MOCK] Requesting loan: assetId=${assetId}, amount=${amount}`);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockLoanId = Math.floor(Math.random() * 10000);
    const mockTxHash = '0x' + Math.random().toString(16).substr(2, 64);
    
    logger.info(`[MOCK] Loan requested: ID ${mockLoanId}`);
    
    return {
      success: true,
      loanId: mockLoanId.toString(),
      transactionHash: mockTxHash,
      blockNumber: 12345678
    };
  }

  async fundLoan({ loanId }) {
    logger.info(`[MOCK] Funding loan: ID ${loanId}`);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockTxHash = '0x' + Math.random().toString(16).substr(2, 64);
    
    return {
      success: true,
      transactionHash: mockTxHash,
      blockNumber: 12345678
    };
  }

  async getAsset(assetId) {
    return {
      id: assetId,
      assetType: 'invoice',
      status: 'verified',
      owner: '0x...',
      value: '50000',
      createdAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString()
    };
  }

  async getLoan(loanId) {
    return {
      id: loanId,
      assetId: '1',
      borrower: '0x...',
      lender: '0x...',
      amount: '50000',
      interestRate: 10,
      termDays: 90,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
  }

  async notifyOracleForVerification(assetId) {
    logger.info(`[MOCK] Oracle notified for asset ${assetId}`);
    return { notified: true };
  }
}

export const blockchainService = new BlockchainService();

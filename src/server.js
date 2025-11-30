/**
 * GoodFi Backend API Server
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { blockchainService } from './services/blockchain.js';

import authRoutes from './routes/auth.js';
import assetRoutes from './routes/assets.js';
import loanRoutes from './routes/loans.js';
import milestoneRoutes from './routes/milestones.js';
import disputeRoutes from './routes/disputes.js';
import userRoutes from './routes/users.js';
import escrowRoutes from './routes/escrow.js';
import milestonesEscrowRoutes from './routes/milestones-escrow.js';
import verificationLenderRoutes from './routes/verification-lender.js';
import lenderRoutes from './routes/lender.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:8080',
    'http://localhost:5173',
    'https://preview--goodfi.lovable.app',
    'https://goodfi.lovable.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/escrow', escrowRoutes);
app.use('/api/milestones', milestonesEscrowRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/verification', verificationLenderRoutes);
app.use('/api/lender', lenderRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Initialize and start
async function start() {
  try {
    console.log('Initializing blockchain service...');
    await blockchainService.initialize();
    console.log('✅ Blockchain service initialized');
    
    app.listen(PORT, () => {
      console.log('🚀 GoodFi Backend API running on port', PORT);
      console.log('📡 Environment:', process.env.NODE_ENV || 'development');
      console.log('🔗 Frontend URL:', process.env.FRONTEND_URL || 'http://localhost:8080');
      console.log('⛓️  Oracle Service:', process.env.ORACLE_SERVICE_URL || 'http://localhost:3000');
      console.log('');
      console.log('API Endpoints:');
      console.log('  POST   /api/auth/register');
      console.log('  POST   /api/auth/login');
      console.log('  GET    /api/auth/me');
      console.log('  POST   /api/assets/create');
      console.log('  GET    /api/assets/:id');
      console.log('  GET    /api/assets');
      console.log('  POST   /api/loans/request');
      console.log('  GET    /api/loans/:id');
      console.log('  GET    /api/loans');
      console.log('  POST   /api/loans/:id/fund');
      console.log('  GET    /api/lender/stats');
      console.log('  GET    /api/lender/all-loans');
      console.log('  GET    /api/lender/loan/:id');
      console.log('  POST   /api/lender/loan/:id/approve');
      console.log('  POST   /api/lender/loan/:id/reject');
      console.log('  GET    /health');
      console.log('');
      console.log('✅ Server ready!');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;
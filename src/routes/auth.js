/**
 * Authentication API Routes - Updated for existing profiles schema
 */

import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('AuthAPI');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, user_type, phone } = req.body;

    logger.info(`Registration attempt: ${email}, type: ${user_type}`);

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || 'User',
        user_type: user_type || 'sme'
      }
    });

    if (authError) throw new Error(`Auth error: ${authError.message}`);

    // Create profile using YOUR schema (name, role, phone)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authData.user.id,
        name: full_name || 'User',
        role: user_type || 'sme',
        phone: phone || null,
        email_notifications: true,
        sms_notifications: false,
        created_at: new Date().toISOString()
      });

    if (profileError) {
      logger.warn(`Failed to create profile: ${profileError.message}`);
    }

    // ✅ FIXED: Sign in the user to get session tokens
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      logger.error('Failed to sign in after registration:', signInError);
      throw new Error('Registration succeeded but login failed');
    }

    logger.info(`User registered successfully: ${email}`);

    // ✅ FIXED: Return session tokens like the login endpoint does
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: full_name || 'User',
        role: user_type || 'sme',
        phone: phone || null
      },
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at: signInData.session.expires_at
      }
    });

  } catch (error) {
    logger.error('Registration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    logger.info(`Login attempt: ${email}`);

    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw new Error(error.message);

    // Get profile to get role
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, name, phone')
      .eq('id', data.user.id)
      .single();

    logger.info(`Login successful: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: data.user.id,
        email: data.user.email,
        name: profile?.name || data.user.user_metadata?.full_name || 'User',
        role: profile?.role || data.user.user_metadata?.user_type || 'sme',
        phone: profile?.phone
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });

  } catch (error) {
    logger.error('Login failed:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid credentials',
      message: error.message
    });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!supabaseAdmin) {
      return res.status(503).json({
        success: false,
        error: 'Service not configured'
      });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: profile?.name,
        role: profile?.role,
        phone: profile?.phone,
        email_notifications: profile?.email_notifications,
        sms_notifications: profile?.sms_notifications
      }
    });

  } catch (error) {
    logger.error('Failed to get user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user'
    });
  }
});

export default router;
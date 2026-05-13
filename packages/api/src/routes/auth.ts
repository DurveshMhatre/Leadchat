// ============================================
// LeadChat API — Auth Routes
// POST /api/auth/register — create user after OTP
// GET  /api/auth/me — current user profile
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { verifyFirebaseToken } from '../config/firebase.js';
import { recomputeAndSaveScore } from '../services/scoreEngine.js';
import { toPublicProfile, getUserByFirebaseUid } from '../services/matchDb.js';
import { AppError } from '../middleware/errorHandler.js';

export const authRouter = Router();

// --- Register Schema ---

const registerSchema = z.object({
  role: z.enum(['buyer', 'provider']),
  displayName: z.string().min(2).max(100),
  industry: z.enum([
    'technology', 'design', 'marketing', 'finance', 'legal',
    'construction', 'retail', 'education', 'healthcare', 'hospitality', 'other',
  ]),
  phone: z.string().regex(/^\+91\d{10}$/, 'Phone must be +91 followed by 10 digits'),
  serviceType: z.string().max(200).optional(),
  tagline: z.string().max(100).optional(),
});

/**
 * POST /api/auth/register
 *
 * Called after Firebase Phone OTP succeeds on the client.
 * The mobile app sends the Firebase ID token + profile data.
 *
 * Flow:
 * 1. Verify Firebase token
 * 2. Check if user already exists (return existing if so)
 * 3. Create new user in PostgreSQL
 * 4. Insert Level 1 verification (phone)
 * 5. Compute initial AI score
 * 6. Return full user profile
 */
authRouter.post('/auth/register', async (req, res, next) => {
  try {
    // Extract and verify Firebase token
    const authHeader = req.headers.authorization;
    let firebaseUid: string;

    if (process.env['NODE_ENV'] === 'development') {
      // Dev bypass: accept test user ID
      const testId = req.headers['x-test-user-id'];
      if (typeof testId === 'string' && testId.length > 0) {
        firebaseUid = testId;
      } else if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const decoded = await verifyFirebaseToken(token);
        if (!decoded) throw new AppError(401, 'Invalid Firebase token', 'AUTH_INVALID');
        firebaseUid = decoded.uid;
      } else {
        throw new AppError(401, 'Missing Authorization header', 'AUTH_MISSING');
      }
    } else {
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AppError(401, 'Missing Authorization header', 'AUTH_MISSING');
      }
      const token = authHeader.slice(7);
      const decoded = await verifyFirebaseToken(token);
      if (!decoded) throw new AppError(401, 'Invalid Firebase token', 'AUTH_INVALID');
      firebaseUid = decoded.uid;
    }

    // Validate request body
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid registration data', 'VALIDATION_ERROR');
    }

    const { role, displayName, industry, phone, serviceType, tagline } = parsed.data;

    // Check if user already exists
    const existing = await getUserByFirebaseUid(firebaseUid);
    if (existing) {
      // Return existing user
      res.json({
        success: true,
        data: toPublicProfile(existing),
        message: 'User already registered',
      });
      return;
    }

    // Create new user
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, firebase_uid, role, display_name, industry, phone, service_type, tagline, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [userId, firebaseUid, role, displayName, industry, phone, serviceType ?? null, tagline ?? null],
    );

    // Insert Level 1 verification (Phone OTP)
    await pool.query(
      `INSERT INTO user_verifications (user_id, level, metadata)
       VALUES ($1, 'phone', $2)
       ON CONFLICT (user_id, level) DO NOTHING`,
      [userId, JSON.stringify({ phone })],
    );

    // Compute initial AI score
    const breakdown = await recomputeAndSaveScore(userId);

    // Fetch the created user
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [userId],
    );
    const user = result.rows[0];

    res.status(201).json({
      success: true,
      data: {
        user: toPublicProfile(user),
        scoreBreakdown: breakdown,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user's full profile.
 * Requires auth middleware.
 */
authRouter.get('/auth/me', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [req.userId],
    );

    const user = result.rows[0];
    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    res.json({
      success: true,
      data: toPublicProfile(user),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// LeadChat API — Profile Routes
// POST /api/profile/update — update profile
// GET  /api/profile/:userId/public — public view
// GET  /api/profile/:userId/score — score breakdown
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { recomputeAndSaveScore, getBadgeForScore } from '../services/scoreEngine.js';
import { toPublicProfile } from '../services/matchDb.js';
import { AppError } from '../middleware/errorHandler.js';

export const profileRouter = Router();

// --- Update Profile Schema ---

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  serviceType: z.string().max(200).optional(),
  tagline: z.string().max(100).optional(),
  budgetMin: z.number().int().min(0).optional(),
  budgetMax: z.number().int().min(0).optional(),
  portfolioUrl: z.string().url().max(500).optional(),
  email: z.string().email().max(255).optional(),
  gstNumber: z.string().max(15).optional(),
  avatarUrl: z.string().url().max(500).optional(),
});

/**
 * POST /api/profile/update
 *
 * Update the authenticated user's profile fields.
 * Automatically recomputes AI score after update.
 */
profileRouter.post('/profile/update', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) {
      throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid profile data', 'VALIDATION_ERROR');
    }

    const data = parsed.data;

    // Build dynamic SET clause — only update provided fields
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      displayName: 'display_name',
      serviceType: 'service_type',
      tagline: 'tagline',
      budgetMin: 'budget_min',
      budgetMax: 'budget_max',
      portfolioUrl: 'portfolio_url',
      email: 'email',
      gstNumber: 'gst_number',
      avatarUrl: 'avatar_url',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (data[key as keyof typeof data] !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(data[key as keyof typeof data]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      throw new AppError(400, 'No fields to update', 'EMPTY_UPDATE');
    }

    // Execute update
    values.push(req.userId);
    await pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values,
    );

    // Recompute AI score
    const breakdown = await recomputeAndSaveScore(req.userId);

    // Fetch updated user
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.userId]);
    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        user: toPublicProfile(user),
        scoreBreakdown: breakdown,
        badge: getBadgeForScore(breakdown.total),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/:userId/public
 *
 * Returns a safe public-facing profile (no phone/email/GST).
 * No auth required — used by QuickPitchCard.
 */
profileRouter.get('/profile/:userId/public', async (req, res, next) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = result.rows[0];

    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        ...toPublicProfile(user),
        badge: getBadgeForScore(user.ai_score),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/:userId/score
 *
 * Returns the AI score breakdown for a user.
 * Requires auth — you can only see your own score breakdown.
 */
profileRouter.get('/profile/:userId/score', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Can only view your own score breakdown
    if (req.userId !== userId) {
      throw new AppError(403, 'Cannot view another user\'s score breakdown', 'FORBIDDEN');
    }

    const userResult = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    // Get verifications
    const verResult = await pool.query(
      `SELECT level, verified_at, metadata FROM user_verifications WHERE user_id = $1`,
      [userId],
    );

    const verifications = verResult.rows.map((r: Record<string, unknown>) => ({
      level: r.level,
      verifiedAt: r.verified_at,
      metadata: r.metadata,
    }));

    // Compute current breakdown
    const breakdown = await recomputeAndSaveScore(userId!);

    res.json({
      success: true,
      data: {
        aiScore: breakdown.total,
        breakdown,
        badge: getBadgeForScore(breakdown.total),
        verifications,
      },
    });
  } catch (error) {
    next(error);
  }
});

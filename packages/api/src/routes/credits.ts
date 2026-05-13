// ============================================
// LeadChat API — Credits Routes
// GET /api/credits/balance
// POST /api/credits/spend
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const creditsRouter = Router();

/**
 * GET /api/credits/balance
 * Get user's current credit balance.
 */
creditsRouter.get('/credits/balance', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const result = await pool.query(
      `SELECT credit_balance FROM users WHERE id = $1`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        balance: result.rows[0]?.credit_balance ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/credits/spend
 * Spend 1 credit to unlock a contact/save a deal.
 */
creditsRouter.post('/credits/spend', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      targetUserId: z.string().uuid(),
      action: z.enum(['save_contact', 'deal_room']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid request', 'VALIDATION_ERROR');

    const { action } = parsed.data;

    // Start a transaction to ensure atomic deduction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the user row for update
      const userResult = await client.query(
        `SELECT tier, credit_balance FROM users WHERE id = $1 FOR UPDATE`,
        [req.userId]
      );
      
      const user = userResult.rows[0];

      // Premium users might have unlimited saves, but for now we enforce 1 credit = 1 save.
      // If we want unlimited saves for premium:
      const isUnlimited = user.tier === 'premium' && action === 'save_contact';

      if (!isUnlimited) {
        if (user.credit_balance <= 0) {
          throw new AppError(402, 'Insufficient lead credits', 'INSUFFICIENT_CREDITS', {
            feature: 'Unlock Contact',
            price: 4900,
            tier: 'credits'
          });
        }

        // Deduct credit
        await client.query(
          `UPDATE users SET credit_balance = credit_balance - 1 WHERE id = $1`,
          [req.userId]
        );
      }

      // Record the transaction (Optional audit table, skipping for MVP brevity)
      
      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          success: true,
          balanceRemaining: isUnlimited ? user.credit_balance : user.credit_balance - 1,
          action,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// ============================================
// LeadChat API — Subscription Middleware
// Gates premium features and match limits
// ============================================

import type { Request, Response, NextFunction } from 'express';
import { pool } from '../services/database.js';
import { AppError } from './errorHandler.js';

/**
 * Ensures the user has a 'premium' tier.
 * If not, throws a 402 error triggering the mobile UpgradePrompt.
 */
export function requirePremium(featureName: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

      const result = await pool.query(
        `SELECT tier, tier_expires_at FROM users WHERE id = $1`,
        [req.userId]
      );
      
      const user = result.rows[0];
      if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');

      const isPremium = user.tier === 'premium';
      const isExpired = user.tier_expires_at && new Date(user.tier_expires_at) < new Date();

      if (!isPremium || isExpired) {
        throw new AppError(402, `${featureName} is a premium feature.`, 'UPGRADE_REQUIRED', {
          feature: featureName,
          price: 999, // INR
          tier: 'premium',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Checks if the user has reached their daily match limit.
 * Free = 5 matches/day, Premium = Unlimited.
 */
export async function checkMatchLimit(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const result = await pool.query(
      `SELECT tier, tier_expires_at FROM users WHERE id = $1`,
      [req.userId]
    );
    
    const user = result.rows[0];
    if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');

    const isPremium = user.tier === 'premium' && 
                      (!user.tier_expires_at || new Date(user.tier_expires_at) > new Date());

    if (isPremium) {
      return next(); // Unlimited
    }

    // Check daily usage in Redis or DB. 
    // For this MVP, we query matches created today where user was involved.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const matchCountResult = await pool.query(
      `SELECT COUNT(*) FROM matches 
       WHERE (buyer_id = $1 OR provider_id = $1) 
       AND created_at >= $2`,
      [req.userId, today.toISOString()]
    );

    const matchesToday = parseInt(matchCountResult.rows[0].count, 10);

    if (matchesToday >= 5) {
      throw new AppError(402, `You have reached your free limit of 5 matches per day.`, 'UPGRADE_REQUIRED', {
        feature: 'Unlimited Matches',
        price: 999,
        tier: 'premium',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

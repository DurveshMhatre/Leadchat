// ============================================
// LeadChat API — Verification Routes
// POST /api/profile/verify/email — business domain check
// POST /api/profile/verify/gst — Setu GST validation
// POST /api/profile/verify/portfolio — URL reachability
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { recomputeAndSaveScore, getBadgeForScore } from '../services/scoreEngine.js';
import { verifyGSTIN } from '../services/gstVerification.js';
import { AppError } from '../middleware/errorHandler.js';

export const verifyRouter = Router();

// --- Personal email domains (not business) ---

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com',
  'live.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'zoho.com', 'yandex.com', 'rediffmail.com', 'proton.me',
]);

/**
 * POST /api/profile/verify/email
 *
 * Level 2 Verification: Business email domain check.
 * Checks if the email domain is a business domain (not gmail/yahoo/etc).
 * Adds +10 to AI score if verified.
 */
verifyRouter.post('/profile/verify/email', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid email', 'VALIDATION_ERROR');

    const { email } = parsed.data;
    const domain = email.split('@')[1]?.toLowerCase();

    if (!domain) {
      throw new AppError(400, 'Invalid email format', 'INVALID_EMAIL');
    }

    const isBusinessDomain = !PERSONAL_DOMAINS.has(domain);

    if (!isBusinessDomain) {
      res.json({
        success: false,
        error: {
          code: 'PERSONAL_EMAIL',
          message: `${domain} is a personal email provider. Please use your business email (e.g., you@yourcompany.com).`,
        },
      });
      return;
    }

    // Update user email
    await pool.query(
      `UPDATE users SET email = $1, email_verified = true WHERE id = $2`,
      [email, req.userId],
    );

    // Insert verification record
    await pool.query(
      `INSERT INTO user_verifications (user_id, level, metadata)
       VALUES ($1, 'email', $2)
       ON CONFLICT (user_id, level) DO UPDATE SET verified_at = NOW(), metadata = $2`,
      [req.userId, JSON.stringify({ email, domain })],
    );

    // Recompute score
    const breakdown = await recomputeAndSaveScore(req.userId);

    res.json({
      success: true,
      data: {
        verified: true,
        domain,
        scoreBreakdown: breakdown,
        badge: getBadgeForScore(breakdown.total),
        message: `Business email verified! +10 to your trust score.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/verify/gst
 *
 * Level 3 Verification: GST number validation via Setu API.
 * Calls Setu's GSTIN lookup endpoint.
 * Adds +20 to AI score if validated successfully.
 */
verifyRouter.post('/profile/verify/gst', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      gstNumber: z.string().length(15, 'GSTIN must be exactly 15 characters'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid GST number', 'VALIDATION_ERROR');

    const { gstNumber } = parsed.data;

    // Call Setu GST API
    const result = await verifyGSTIN(gstNumber);

    if (!result.valid) {
      res.json({
        success: false,
        error: {
          code: 'GST_INVALID',
          message: result.error ?? `GST number is not valid or not active (status: ${result.status})`,
        },
      });
      return;
    }

    // Update user GST number and verification flag
    await pool.query(
      `UPDATE users SET gst_number = $1, gst_verified = true WHERE id = $2`,
      [gstNumber, req.userId],
    );

    // Insert verification record
    await pool.query(
      `INSERT INTO user_verifications (user_id, level, metadata)
       VALUES ($1, 'gst', $2)
       ON CONFLICT (user_id, level) DO UPDATE SET verified_at = NOW(), metadata = $2`,
      [req.userId, JSON.stringify({
        gstin: result.gstin,
        legalName: result.legalName,
        tradeName: result.tradeName,
        status: result.status,
      })],
    );

    // Recompute score
    const breakdown = await recomputeAndSaveScore(req.userId);

    res.json({
      success: true,
      data: {
        verified: true,
        legalName: result.legalName,
        tradeName: result.tradeName,
        status: result.status,
        scoreBreakdown: breakdown,
        badge: getBadgeForScore(breakdown.total),
        message: `GST verified! +20 to your trust score.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/verify/portfolio
 *
 * Level 4 Verification: Portfolio URL reachability check.
 * Sends an HTTP HEAD request to verify the URL is live.
 * Adds +5 to AI score if reachable.
 */
verifyRouter.post('/profile/verify/portfolio', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      portfolioUrl: z.string().url('Must be a valid URL'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid portfolio URL', 'VALIDATION_ERROR');

    const { portfolioUrl } = parsed.data;

    // Check URL reachability via HEAD request
    let isReachable = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const response = await fetch(portfolioUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);
      isReachable = response.ok; // 2xx status
    } catch {
      // URL not reachable — that's fine, just report it
      isReachable = false;
    }

    if (!isReachable) {
      res.json({
        success: false,
        error: {
          code: 'URL_UNREACHABLE',
          message: 'Could not reach your portfolio URL. Make sure it\'s live and accessible.',
        },
      });
      return;
    }

    // Update user portfolio and verification flag
    await pool.query(
      `UPDATE users SET portfolio_url = $1, portfolio_verified = true WHERE id = $2`,
      [portfolioUrl, req.userId],
    );

    // Insert verification record
    await pool.query(
      `INSERT INTO user_verifications (user_id, level, metadata)
       VALUES ($1, 'portfolio', $2)
       ON CONFLICT (user_id, level) DO UPDATE SET verified_at = NOW(), metadata = $2`,
      [req.userId, JSON.stringify({ url: portfolioUrl })],
    );

    // Recompute score
    const breakdown = await recomputeAndSaveScore(req.userId);

    res.json({
      success: true,
      data: {
        verified: true,
        url: portfolioUrl,
        scoreBreakdown: breakdown,
        badge: getBadgeForScore(breakdown.total),
        message: `Portfolio verified! +5 to your trust score.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

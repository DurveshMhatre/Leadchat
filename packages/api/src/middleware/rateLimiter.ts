// ============================================
// LeadChat API — Rate Limiter Middleware
// Prevents abuse and enforces per-user request limits
// ============================================

import rateLimit from 'express-rate-limit';

/**
 * Global API rate limiter.
 * 100 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait a moment before trying again.',
    },
  },
});

/**
 * Strict rate limiter for sensitive endpoints (chat, billing).
 * 10 requests per second per IP.
 */
export const strictLimiter = rateLimit({
  windowMs: 1_000, // 1 second
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Slow down.',
    },
  },
});

/**
 * Auth-specific limiter to prevent brute force.
 * 5 requests per minute per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many auth attempts. Please wait a minute.',
    },
  },
});

// ============================================
// LeadChat API — Billing Routes
// POST /api/billing/create-order
// POST /api/billing/verify
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { getRazorpayClient, verifyRazorpaySignature } from '../services/razorpay.js';

export const billingRouter = Router();

// --- Product Definitions ---

export const PRODUCTS = {
  premium_subscription: { amount: 99900, description: 'Premium Subscription (1 Month)', credits: 0, type: 'subscription' },
  credits_10: { amount: 39900, description: '10 Lead Credits', credits: 10, type: 'credits' },
  credits_25: { amount: 79900, description: '25 Lead Credits', credits: 25, type: 'credits' },
} as const;

type ProductId = keyof typeof PRODUCTS;

// --- Orders Table (Implicitly using JSONB or extending DB later) ---
// For this MVP, we will directly trust the Razorpay signature to fulfill orders.
// In a highly robust system, we would store order_id in an `orders` table first.

/**
 * POST /api/billing/create-order
 * Creates a Razorpay order for a specific product.
 */
billingRouter.post('/billing/create-order', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      productId: z.enum(['premium_subscription', 'credits_10', 'credits_25']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid product ID', 'VALIDATION_ERROR');

    const productId = parsed.data.productId as ProductId;
    const product = PRODUCTS[productId];

    const rzp = getRazorpayClient();

    // Create Razorpay Order
    const order = await rzp.orders.create({
      amount: product.amount,
      currency: 'INR',
      receipt: `rcpt_${req.userId.substring(0, 8)}_${Date.now()}`,
      notes: {
        userId: req.userId,
        productId,
        type: product.type,
      },
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        productId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/verify
 * Called by the mobile app after successful payment completion.
 * Verifies signature and provisions the product.
 */
billingRouter.post('/billing/verify', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
      productId: z.enum(['premium_subscription', 'credits_10', 'credits_25']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid payment payload', 'VALIDATION_ERROR');

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, productId } = parsed.data;

    // Verify Signature
    const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      throw new AppError(400, 'Invalid payment signature', 'PAYMENT_VERIFICATION_FAILED');
    }

    const product = PRODUCTS[productId as ProductId];

    // Fulfill Order
    if (product.type === 'subscription') {
      // 30 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await pool.query(
        `UPDATE users SET tier = 'premium', tier_expires_at = $1 WHERE id = $2`,
        [expiresAt, req.userId],
      );
    } else if (product.type === 'credits') {
      await pool.query(
        `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`,
        [product.credits, req.userId],
      );
    }

    // Fetch updated user to return fresh state
    const result = await pool.query(
      `SELECT tier, credit_balance, tier_expires_at FROM users WHERE id = $1`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        status: 'fulfilled',
        user: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
});

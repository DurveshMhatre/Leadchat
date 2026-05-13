// ============================================
// LeadChat API — Razorpay Service
// Handles creating orders and verifying signatures
// ============================================

import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { config } from '../config/index.js';

let razorpayClient: Razorpay | null = null;

/**
 * Get Razorpay client instance.
 * Initializes lazily using environment variables.
 */
export function getRazorpayClient(): Razorpay {
  if (razorpayClient) return razorpayClient;

  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = config;

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay credentials not configured in environment');
  }

  razorpayClient = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });

  return razorpayClient;
}

/**
 * Verify Razorpay webhook or payment signature using HMAC-SHA256.
 *
 * @param orderId The internal order ID or Razorpay order ID
 * @param paymentId The Razorpay payment ID
 * @param signature The Razorpay signature from the client/webhook
 * @param secret The webhook secret or key secret depending on context
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret?: string,
): boolean {
  const keySecret = secret ?? config.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error('Razorpay secret not available for verification');
  }

  // Dev bypass for Expo Go mock testing
  if (process.env['NODE_ENV'] === 'development' && signature.startsWith('mock_sig_for_')) {
    return true;
  }

  const payload = `${orderId}|${paymentId}`;
  
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');

  return expectedSignature === signature;
}

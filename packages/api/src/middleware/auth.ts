// ============================================
// LeadChat API — Auth Middleware
// Firebase JWT verification (Mission 4)
// ============================================

import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { verifyFirebaseToken } from '../config/firebase.js';
import { pool } from '../services/database.js';

/**
 * Extend Express Request with authenticated user data.
 */
declare global {
  namespace Express {
    interface Request {
      /** Authenticated user ID (internal UUID, not Firebase UID) */
      userId?: string;
      /** Firebase UID from the decoded token */
      firebaseUid?: string;
    }
  }
}

/**
 * Auth middleware — verifies Firebase JWT from Authorization header.
 *
 * In development mode, accepts a test user ID via X-Test-User-Id header
 * for easier local testing without Firebase.
 *
 * Production flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify with Firebase Admin SDK
 * 3. Look up internal user UUID by firebase_uid
 * 4. Set req.userId and req.firebaseUid
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Development bypass: allow test user header
    if (process.env['NODE_ENV'] === 'development') {
      const testUserId = req.headers['x-test-user-id'];
      if (typeof testUserId === 'string' && testUserId.length > 0) {
        req.firebaseUid = testUserId;

        // Resolve firebase_uid → internal UUID (same as production path)
        const result = await pool.query<{ id: string }>(
          `SELECT id FROM users WHERE firebase_uid = $1`,
          [testUserId],
        );

        if (result.rows[0]) {
          req.userId = result.rows[0].id;
        } else {
          // User not registered yet — let /auth/register handle it
          req.userId = testUserId;
        }

        next();
        return;
      }
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid Authorization header', 'AUTH_MISSING');
    }

    const token = authHeader.slice(7);
    if (token.length === 0) {
      throw new AppError(401, 'Empty authentication token', 'AUTH_EMPTY');
    }

    // Verify token with Firebase Admin SDK
    const decoded = await verifyFirebaseToken(token);
    if (!decoded) {
      throw new AppError(401, 'Invalid or expired authentication token', 'AUTH_INVALID');
    }

    const firebaseUid = decoded.uid;
    req.firebaseUid = firebaseUid;

    // Look up internal user by firebase_uid
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE firebase_uid = $1`,
      [firebaseUid],
    );

    if (result.rows[0]) {
      req.userId = result.rows[0].id;
    } else {
      // User exists in Firebase but not in our DB yet
      // This is OK for the /auth/register endpoint
      req.userId = undefined;
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(401, 'Authentication failed', 'AUTH_FAILED'));
  }
}

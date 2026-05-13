// ============================================
// LeadChat API — SubscriptionMiddleware Unit Tests
// Tests all 6 feature gate scenarios
// ============================================

// Mock the database pool before imports
const mockQuery = jest.fn();
jest.mock('../services/database.js', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import type { Request, Response, NextFunction } from 'express';
import { requirePremium, checkMatchLimit } from '../middleware/subscription.js';

// --- Helpers ---

function makeReq(userId?: string): Partial<Request> {
  return { userId };
}

function makeRes(): Partial<Response> {
  return {};
}

let nextCalled: boolean;
let nextError: any;

function makeNext(): NextFunction {
  nextCalled = false;
  nextError = undefined;
  return ((err?: any) => {
    nextCalled = true;
    nextError = err;
  }) as NextFunction;
}

beforeEach(() => {
  jest.clearAllMocks();
  nextCalled = false;
  nextError = undefined;
});

// --- requirePremium() Tests ---

describe('requirePremium()', () => {
  const middleware = requirePremium('Budget Filters');

  test('1. Blocks unauthenticated user with 401', async () => {
    const next = makeNext();
    await middleware(makeReq(undefined) as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeDefined();
    expect(nextError.statusCode).toBe(401);
    expect(nextError.code).toBe('AUTH_REQUIRED');
  });

  test('2. Blocks free-tier user with 402 UPGRADE_REQUIRED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tier: 'free', tier_expires_at: null }],
    });

    const next = makeNext();
    await middleware(makeReq('user-free') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError.statusCode).toBe(402);
    expect(nextError.code).toBe('UPGRADE_REQUIRED');
    expect(nextError.details.feature).toBe('Budget Filters');
  });

  test('3. Blocks expired premium user with 402', async () => {
    const expired = new Date();
    expired.setDate(expired.getDate() - 1); // yesterday

    mockQuery.mockResolvedValueOnce({
      rows: [{ tier: 'premium', tier_expires_at: expired.toISOString() }],
    });

    const next = makeNext();
    await middleware(makeReq('user-expired') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError.statusCode).toBe(402);
    expect(nextError.code).toBe('UPGRADE_REQUIRED');
  });

  test('4. Allows active premium user through', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);

    mockQuery.mockResolvedValueOnce({
      rows: [{ tier: 'premium', tier_expires_at: future.toISOString() }],
    });

    const next = makeNext();
    await middleware(makeReq('user-premium') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
  });

  test('5. Returns 404 for non-existent user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const next = makeNext();
    await middleware(makeReq('user-ghost') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError.statusCode).toBe(404);
    expect(nextError.code).toBe('USER_NOT_FOUND');
  });

  test('6. Allows premium user without expiry date (lifetime)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tier: 'premium', tier_expires_at: null }],
    });

    const next = makeNext();
    await middleware(makeReq('user-lifetime') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
  });
});

// --- checkMatchLimit() Tests ---

describe('checkMatchLimit()', () => {
  test('7. Allows premium user unlimited matches', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);

    mockQuery.mockResolvedValueOnce({
      rows: [{ tier: 'premium', tier_expires_at: future.toISOString() }],
    });

    const next = makeNext();
    await checkMatchLimit(makeReq('user-premium') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    // Should only call the user query, not the match count query
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('8. Allows free user under match limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'free', tier_expires_at: null }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const next = makeNext();
    await checkMatchLimit(makeReq('user-free') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
  });

  test('9. Blocks free user at exactly 5 matches with 402', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'free', tier_expires_at: null }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const next = makeNext();
    await checkMatchLimit(makeReq('user-free') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError.statusCode).toBe(402);
    expect(nextError.code).toBe('UPGRADE_REQUIRED');
    expect(nextError.details.feature).toBe('Unlimited Matches');
  });

  test('10. Blocks free user exceeding match limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'free', tier_expires_at: null }] })
      .mockResolvedValueOnce({ rows: [{ count: '10' }] });

    const next = makeNext();
    await checkMatchLimit(makeReq('user-free') as Request, makeRes() as Response, next);

    expect(nextCalled).toBe(true);
    expect(nextError.statusCode).toBe(402);
  });
});

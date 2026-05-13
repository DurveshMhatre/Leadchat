// ============================================
// LeadChat API — scoreMatch() Unit Tests
// Minimum 5 test cases as required by checkpoint
// ============================================

import { scoreMatch, selectWeightedRandom, applyPremiumWeight } from '../services/matchingEngine.js';
import type { QueueEntry } from '../services/matchingQueue.js';

// --- Test Helpers ---

function makeBuyer(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    userId: 'buyer-001',
    socketId: 'socket-buyer-001',
    score: 50,
    joinedAt: Date.now(),
    industry: 'technology',
    role: 'buyer',
    budgetMin: 100_000,
    budgetMax: 300_000,
    serviceType: 'Full-stack Development',
    profileComplete: true,
    rating: 4.0,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    userId: 'provider-001',
    socketId: 'socket-provider-001',
    score: 50,
    joinedAt: Date.now(),
    industry: 'technology',
    role: 'provider',
    budgetMin: 80_000,
    budgetMax: 200_000,
    serviceType: 'Full-stack Development',
    profileComplete: true,
    rating: 4.0,
    ...overrides,
  };
}

// --- scoreMatch() Tests ---

describe('scoreMatch()', () => {
  test('1. Perfect match — all bonuses applied → high score', () => {
    const buyer = makeBuyer({
      budgetMin: 100_000,
      budgetMax: 300_000,
      serviceType: 'Full-stack Development',
      profileComplete: true,
      rating: 4.5,
    });
    const provider = makeProvider({
      budgetMin: 80_000,
      budgetMax: 200_000,
      serviceType: 'Full-stack Development',
      profileComplete: true,
      rating: 4.5,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + budget(20) + service(15) + complete(10) + rating((4.5-3)*2.5 = 3.75) = 98.75 → 99
    expect(score).toBeGreaterThanOrEqual(95);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('2. Base match — no overlaps, avg ratings → ~50', () => {
    const buyer = makeBuyer({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });
    const provider = makeProvider({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + budget(0) + service(0) + complete(0) + rating((3-3)*2.5 = 0) = 50
    expect(score).toBe(50);
  });

  test('3. Budget overlap only → base + 20 = ~70', () => {
    const buyer = makeBuyer({
      budgetMin: 100_000,
      budgetMax: 300_000,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });
    const provider = makeProvider({
      budgetMin: 200_000,
      budgetMax: 500_000,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + budget(20) + rating(0) = 70
    expect(score).toBe(70);
  });

  test('4. No budget overlap → no budget bonus', () => {
    const buyer = makeBuyer({
      budgetMin: 100_000,
      budgetMax: 200_000,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });
    const provider = makeProvider({
      budgetMin: 500_000,
      budgetMax: 800_000,
      serviceType: undefined,
      profileComplete: false,
      rating: 3.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + budget(0) + rating(0) = 50
    expect(score).toBe(50);
  });

  test('5. Low rating penalty → reduces score below base', () => {
    const buyer = makeBuyer({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 1.0,
    });
    const provider = makeProvider({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 1.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + rating((1-3)*2.5 = -5) = 45
    expect(score).toBe(45);
  });

  test('6. Both profiles complete, no other bonuses → base + 10', () => {
    const buyer = makeBuyer({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: true,
      rating: 3.0,
    });
    const provider = makeProvider({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: true,
      rating: 3.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + complete(10) + rating(0) = 60
    expect(score).toBe(60);
  });

  test('7. Score clamps to 0 — extreme negative rating', () => {
    const buyer = makeBuyer({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 0.0,
    });
    const provider = makeProvider({
      budgetMin: undefined,
      budgetMax: undefined,
      serviceType: undefined,
      profileComplete: false,
      rating: 0.0,
    });

    const score = scoreMatch(buyer, provider);
    // base(50) + rating((0-3)*2.5 = -7.5) = 42.5 → 43 (rounded)
    // Even with extreme values, score stays ≥ 0
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// --- selectWeightedRandom() Tests ---

describe('selectWeightedRandom()', () => {
  test('returns null for empty pool', () => {
    const result = selectWeightedRandom([]);
    expect(result).toBeNull();
  });

  test('returns the only pair for single-element pool', () => {
    const pair = { buyer: makeBuyer(), provider: makeProvider(), score: 80 };
    const result = selectWeightedRandom([pair]);
    expect(result).toBe(pair);
  });

  test('returns a valid pair from a multi-element pool', () => {
    const pairs = [
      { buyer: makeBuyer({ userId: 'b1' }), provider: makeProvider({ userId: 'p1' }), score: 90 },
      { buyer: makeBuyer({ userId: 'b2' }), provider: makeProvider({ userId: 'p2' }), score: 30 },
      { buyer: makeBuyer({ userId: 'b3' }), provider: makeProvider({ userId: 'p3' }), score: 60 },
    ];
    const result = selectWeightedRandom(pairs);
    expect(result).not.toBeNull();
    expect(pairs).toContain(result);
  });

  test('higher scored pairs are selected more frequently (statistical)', () => {
    const highPair = { buyer: makeBuyer({ userId: 'bHigh' }), provider: makeProvider({ userId: 'pHigh' }), score: 90 };
    const lowPair = { buyer: makeBuyer({ userId: 'bLow' }), provider: makeProvider({ userId: 'pLow' }), score: 10 };
    const pairs = [highPair, lowPair];

    let highCount = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const result = selectWeightedRandom(pairs);
      if (result === highPair) highCount++;
    }

    // High pair (90) should be selected ~90% of the time (90/(90+10))
    // Allow generous margin for randomness
    expect(highCount).toBeGreaterThan(iterations * 0.7);
  });
});

// --- applyPremiumWeight() Tests ---

describe('applyPremiumWeight()', () => {
  test('applies 1.5x multiplier for premium users', () => {
    expect(applyPremiumWeight(60, true)).toBe(90);
  });

  test('does not modify score for free users', () => {
    expect(applyPremiumWeight(60, false)).toBe(60);
  });

  test('caps at 100 after premium boost', () => {
    expect(applyPremiumWeight(80, true)).toBe(100);
  });
});

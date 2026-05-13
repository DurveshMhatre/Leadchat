// ============================================
// LeadChat API — Matching Engine
// The brain of LeadChat — intelligent random matching
// ============================================

import type { Industry } from '@leadchat/shared';
import {
  MATCHING_CYCLE_INTERVAL_MS,
  MATCH_TIMEOUT_HARD_SECONDS,
  PREMIUM_SCORE_WEIGHT,
} from '@leadchat/shared';
import type { Server as SocketIOServer } from 'socket.io';
import type { QueueEntry } from './matchingQueue.js';
import {
  getPool,
  dequeue,
  getActiveIndustries,
  setActiveMatch,
  getSocketId,
} from './matchingQueue.js';
import {
  havePreviouslyMatched,
  getBlockedUserIds,
  createMatch,
  getUserById,
  toPublicProfile,
  incrementTotalChats,
} from './matchDb.js';

// --- Score Match Algorithm ---

/**
 * Compute compatibility score between a buyer and provider.
 *
 * Algorithm (from prompt spec):
 *   base = 50
 *   +20 if buyer budget overlaps provider typical rate
 *   +15 if provider service type matches buyer needs
 *   +10 if both profiles are complete
 *   ±5  rating bonus: (avgRating - 3) * 2.5
 *   Clamped to [0, 100]
 */
export function scoreMatch(
  buyer: QueueEntry,
  provider: QueueEntry,
): number {
  let score = 50;

  // +20: Budget overlap
  // Buyer has a budget range, provider has a rate range
  // Overlap = buyer.max >= provider.min && buyer.min <= provider.max
  if (
    buyer.budgetMin != null &&
    buyer.budgetMax != null &&
    provider.budgetMin != null &&
    provider.budgetMax != null
  ) {
    const hasOverlap =
      buyer.budgetMax >= provider.budgetMin &&
      buyer.budgetMin <= provider.budgetMax;
    if (hasOverlap) {
      score += 20;
    }
  }

  // +15: Service type match
  // Simple substring match — buyer's serviceType or industry context
  // In a real implementation this would use NLP/embeddings
  if (
    provider.serviceType &&
    buyer.serviceType &&
    provider.serviceType.toLowerCase().includes(buyer.serviceType.toLowerCase())
  ) {
    score += 15;
  }

  // +10: Both profiles complete
  if (buyer.profileComplete && provider.profileComplete) {
    score += 10;
  }

  // ±5: Rating bonus
  // Average both ratings, then (avg - 3) * 2.5
  const avgRating = (buyer.rating + provider.rating) / 2;
  const ratingBonus = (avgRating - 3) * 2.5;
  score += ratingBonus;

  // Clamp to [0, 100]
  return Math.round(Math.max(0, Math.min(100, score)));
}

// --- Weighted Random Selection ---

interface ScoredPair {
  buyer: QueueEntry;
  provider: QueueEntry;
  score: number;
}

/**
 * Select one match pair from a list using weighted randomness.
 * Higher score = more likely to be selected.
 * A score-90 pair is ~3x more likely than a score-30 pair.
 */
export function selectWeightedRandom(pairs: ScoredPair[]): ScoredPair | null {
  if (pairs.length === 0) return null;
  if (pairs.length === 1) return pairs[0] ?? null;

  // Use scores as weights — minimum weight of 1 to avoid zero-weight entries
  const totalWeight = pairs.reduce((sum, p) => sum + Math.max(p.score, 1), 0);
  let random = Math.random() * totalWeight;

  for (const pair of pairs) {
    random -= Math.max(pair.score, 1);
    if (random <= 0) {
      return pair;
    }
  }

  // Fallback (shouldn't happen due to floating point)
  return pairs[pairs.length - 1] ?? null;
}

// --- Matching Engine ---

let matchingInterval: ReturnType<typeof setInterval> | null = null;
let ioInstance: SocketIOServer | null = null;

/**
 * Start the matching engine loop.
 * Runs `runMatchingCycle` for every active industry every MATCHING_CYCLE_INTERVAL_MS.
 */
export function startMatchingLoop(io: SocketIOServer): void {
  ioInstance = io;

  if (matchingInterval) {
    console.warn('⚠️  Matching engine already running');
    return;
  }

  matchingInterval = setInterval(() => {
    void runAllMatchingCycles();
  }, MATCHING_CYCLE_INTERVAL_MS);

  console.log(`🧠 Matching engine started (cycle: ${MATCHING_CYCLE_INTERVAL_MS}ms)`);
}

/**
 * Stop the matching engine loop.
 * Called during graceful shutdown.
 */
export function stopMatchingLoop(): void {
  if (matchingInterval) {
    clearInterval(matchingInterval);
    matchingInterval = null;
    console.log('🧠 Matching engine stopped');
  }
}

/**
 * Run matching cycles for ALL active industries.
 */
async function runAllMatchingCycles(): Promise<void> {
  try {
    const industries = await getActiveIndustries();
    for (const industry of industries) {
      await runMatchingCycle(industry);
    }
  } catch (error) {
    console.error('❌ Matching cycle error:', error);
  }
}

/**
 * Run a single matching cycle for one industry.
 *
 * Steps:
 * 1. Get buyer pool and provider pool from Redis
 * 2. Apply hard filters (no previous match, no blocks)
 * 3. Score each valid buyer-provider pair
 * 4. Select best pair via weighted random
 * 5. Create match in DB, emit events to both sockets
 * 6. Handle timeouts for users waiting too long
 */
async function runMatchingCycle(industry: Industry): Promise<void> {
  const buyers = await getPool(industry, 'buyer');
  const providers = await getPool(industry, 'provider');

  if (buyers.length === 0 || providers.length === 0) {
    // Check for timeout on users waiting with no partners
    await handleTimeouts(buyers, industry);
    await handleTimeouts(providers, industry);
    return;
  }

  // Build all valid pairs with scores
  const scoredPairs: ScoredPair[] = [];

  for (const buyer of buyers) {
    // Get buyer's blocked list (cached per cycle)
    const buyerBlocked = await getBlockedUserIds(buyer.userId);

    for (const provider of providers) {
      // Hard filter: not blocked
      if (buyerBlocked.has(provider.userId)) continue;

      // Hard filter: not blocked by provider
      const providerBlocked = await getBlockedUserIds(provider.userId);
      if (providerBlocked.has(buyer.userId)) continue;

      // Hard filter: not previously matched
      const previouslyMatched = await havePreviouslyMatched(buyer.userId, provider.userId);
      if (previouslyMatched) continue;

      // Score the pair
      const score = scoreMatch(buyer, provider);
      scoredPairs.push({ buyer, provider, score });
    }
  }

  if (scoredPairs.length === 0) {
    await handleTimeouts(buyers, industry);
    await handleTimeouts(providers, industry);
    return;
  }

  // Select the best pair via weighted random
  const selected = selectWeightedRandom(scoredPairs);
  if (!selected) return;

  // Create the match
  await executeMatch(selected.buyer, selected.provider, industry, selected.score);
}

/**
 * Execute a match between a buyer and provider.
 * Creates the DB record, updates Redis, and emits Socket events.
 */
async function executeMatch(
  buyer: QueueEntry,
  provider: QueueEntry,
  industry: Industry,
  score: number,
): Promise<void> {
  if (!ioInstance) return;

  try {
    // Create match in PostgreSQL
    const matchId = await createMatch(buyer.userId, provider.userId, industry, score);

    // Remove both from their queues
    await dequeue(industry, 'buyer', buyer.userId);
    await dequeue(industry, 'provider', provider.userId);

    // Store active match in Redis for fast lookups
    await setActiveMatch(matchId, {
      buyerId: buyer.userId,
      providerId: provider.userId,
      buyerSocketId: buyer.socketId,
      providerSocketId: provider.socketId,
    });

    // Increment total chats for both users
    await incrementTotalChats(buyer.userId);
    await incrementTotalChats(provider.userId);

    // Fetch public profiles for both
    const buyerUser = await getUserById(buyer.userId);
    const providerUser = await getUserById(provider.userId);
    if (!buyerUser || !providerUser) return;

    const buyerProfile = toPublicProfile(buyerUser);
    const providerProfile = toPublicProfile(providerUser);

    // Join both sockets to a match room
    const matchRoom = `match:${matchId}`;
    const buyerSocket = ioInstance.sockets.sockets.get(buyer.socketId);
    const providerSocket = ioInstance.sockets.sockets.get(provider.socketId);

    if (buyerSocket) {
      void buyerSocket.join(matchRoom);
      buyerSocket.emit('match:found', { matchId, partner: providerProfile });
    }

    if (providerSocket) {
      void providerSocket.join(matchRoom);
      providerSocket.emit('match:found', { matchId, partner: buyerProfile });
    }

    console.log(
      `✅ Match created: ${buyer.userId} ↔ ${provider.userId} (score: ${score}, industry: ${industry})`,
    );
  } catch (error) {
    console.error('❌ Failed to execute match:', error);
  }
}

/**
 * Handle timeout logic for users who have been waiting too long.
 *
 * - 90s: Soft timeout — widen radius (handled by lowering score threshold)
 * - 150s: Hard timeout — emit timeout event and remove from queue
 */
async function handleTimeouts(entries: QueueEntry[], industry: Industry): Promise<void> {
  if (!ioInstance) return;

  const now = Date.now();

  for (const entry of entries) {
    const waitTimeSeconds = (now - entry.joinedAt) / 1000;

    if (waitTimeSeconds >= MATCH_TIMEOUT_HARD_SECONDS) {
      // Hard timeout — give up
      await dequeue(industry, entry.role, entry.userId);

      const socketId = await getSocketId(entry.userId);
      if (socketId) {
        const socket = ioInstance.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('match:timeout', {
            reason: 'Low traffic — try a different room or check back later',
          });
        }
      }

      console.log(
        `⏰ Hard timeout: ${entry.userId} (waited ${Math.round(waitTimeSeconds)}s in ${industry})`,
      );
    }
    // Soft timeout (90s) is handled implicitly:
    // The scoreMatch() filters are already soft — if no pairs pass,
    // the engine naturally tries all combinations including low-score ones
  }
}

/**
 * Apply premium score weight boost.
 * Premium users get PREMIUM_SCORE_WEIGHT (1.5x) multiplier in selection.
 */
export function applyPremiumWeight(score: number, isPremium: boolean): number {
  if (isPremium) {
    return Math.min(Math.round(score * PREMIUM_SCORE_WEIGHT), 100);
  }
  return score;
}

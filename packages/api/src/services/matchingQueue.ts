// ============================================
// LeadChat API — Redis Matching Queue
// One queue per industry per role
// ============================================

import type { Industry, UserRole } from '@leadchat/shared';
import { QUEUE_TTL_SECONDS } from '@leadchat/shared';
import { redis } from './redis.js';

/**
 * Shape of an entry in the matching queue.
 * Stored as JSON string in a Redis Hash.
 */
export interface QueueEntry {
  userId: string;
  socketId: string;
  score: number;
  joinedAt: number;
  industry: Industry;
  role: UserRole;
  budgetMin?: number;
  budgetMax?: number;
  serviceType?: string;
  profileComplete: boolean;
  rating: number;
}

// --- Key Builders ---

/** Redis key for a matching queue: queue:{industry}:{role} */
function queueKey(industry: Industry, role: UserRole): string {
  return `queue:${industry}:${role}`;
}

/** Redis key for user TTL tracking: queue:ttl:{userId} */
function ttlKey(userId: string): string {
  return `queue:ttl:${userId}`;
}

/** Redis key for user→socket mapping */
function userSocketKey(userId: string): string {
  return `user:socket:${userId}`;
}

/** Redis key for socket→user mapping */
function socketUserKey(socketId: string): string {
  return `socket:user:${socketId}`;
}

/** Redis key for active match data */
export function activeMatchKey(matchId: string): string {
  return `active:match:${matchId}`;
}

// --- Queue Operations ---

/**
 * Add a user to the matching queue for their industry and role.
 * Also sets socket mapping and TTL key.
 */
export async function enqueue(entry: QueueEntry): Promise<void> {
  const key = queueKey(entry.industry, entry.role);
  const pipeline = redis.pipeline();

  // Store queue entry as JSON in the hash
  pipeline.hset(key, entry.userId, JSON.stringify(entry));

  // Set TTL key — auto-removes stale users
  pipeline.set(ttlKey(entry.userId), '1', 'EX', QUEUE_TTL_SECONDS);

  // Set bidirectional socket mappings
  pipeline.set(userSocketKey(entry.userId), entry.socketId, 'EX', QUEUE_TTL_SECONDS);
  pipeline.set(socketUserKey(entry.socketId), entry.userId, 'EX', QUEUE_TTL_SECONDS);

  await pipeline.exec();
}

/**
 * Remove a user from a specific queue.
 */
export async function dequeue(industry: Industry, role: UserRole, userId: string): Promise<void> {
  const key = queueKey(industry, role);
  const pipeline = redis.pipeline();

  pipeline.hdel(key, userId);
  pipeline.del(ttlKey(userId));

  await pipeline.exec();
}

/**
 * Remove a user from ALL queues (used on disconnect).
 * Scans all queue keys to find and remove the user.
 */
export async function removeFromAllQueues(userId: string): Promise<void> {
  // Get all queue keys
  const keys = await redis.keys('queue:*:*');
  const pipeline = redis.pipeline();

  for (const key of keys) {
    // Skip TTL and non-hash keys
    if (key.startsWith('queue:ttl:')) continue;
    pipeline.hdel(key, userId);
  }

  // Clean up mappings
  const socketId = await redis.get(userSocketKey(userId));
  pipeline.del(ttlKey(userId));
  pipeline.del(userSocketKey(userId));
  if (socketId) {
    pipeline.del(socketUserKey(socketId));
  }

  await pipeline.exec();
}

/**
 * Get all users in a specific queue.
 * Returns parsed QueueEntry objects.
 */
export async function getPool(industry: Industry, role: UserRole): Promise<QueueEntry[]> {
  const key = queueKey(industry, role);
  const raw = await redis.hgetall(key);
  const entries: QueueEntry[] = [];

  for (const [_userId, json] of Object.entries(raw)) {
    try {
      const entry = JSON.parse(json) as QueueEntry;
      entries.push(entry);
    } catch {
      // Skip malformed entries silently
      console.warn(`⚠️  Malformed queue entry in ${key}, skipping`);
    }
  }

  return entries;
}

/**
 * Check if a user is in a specific queue.
 */
export async function peek(industry: Industry, role: UserRole, userId: string): Promise<boolean> {
  const key = queueKey(industry, role);
  const exists = await redis.hexists(key, userId);
  return exists === 1;
}

/**
 * Refresh the TTL for a user (called on activity).
 */
export async function refreshTTL(userId: string): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.expire(ttlKey(userId), QUEUE_TTL_SECONDS);

  const socketId = await redis.get(userSocketKey(userId));
  pipeline.expire(userSocketKey(userId), QUEUE_TTL_SECONDS);
  if (socketId) {
    pipeline.expire(socketUserKey(socketId), QUEUE_TTL_SECONDS);
  }

  await pipeline.exec();
}

/**
 * Get the socket ID for a user.
 */
export async function getSocketId(userId: string): Promise<string | null> {
  return redis.get(userSocketKey(userId));
}

/**
 * Get the user ID for a socket.
 */
export async function getUserIdBySocket(socketId: string): Promise<string | null> {
  return redis.get(socketUserKey(socketId));
}

/**
 * Store active match data in Redis for fast lookups.
 */
export async function setActiveMatch(
  matchId: string,
  data: {
    buyerId: string;
    providerId: string;
    buyerSocketId: string;
    providerSocketId: string;
  },
): Promise<void> {
  const key = activeMatchKey(matchId);
  await redis.hset(key, data);
  await redis.expire(key, 3600); // 1 hour TTL
}

/**
 * Get active match data from Redis.
 */
export async function getActiveMatch(
  matchId: string,
): Promise<{ buyerId: string; providerId: string; buyerSocketId: string; providerSocketId: string } | null> {
  const key = activeMatchKey(matchId);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return data as { buyerId: string; providerId: string; buyerSocketId: string; providerSocketId: string };
}

/**
 * Delete active match data from Redis.
 */
export async function deleteActiveMatch(matchId: string): Promise<void> {
  await redis.del(activeMatchKey(matchId));
}

/**
 * Get all industries that currently have users in queues.
 * Used by the matching engine to know which industries to scan.
 */
export async function getActiveIndustries(): Promise<Industry[]> {
  const keys = await redis.keys('queue:*:*');
  const industries = new Set<Industry>();

  for (const key of keys) {
    if (key.startsWith('queue:ttl:')) continue;
    const parts = key.split(':');
    if (parts.length === 3 && parts[1]) {
      industries.add(parts[1] as Industry);
    }
  }

  return [...industries];
}

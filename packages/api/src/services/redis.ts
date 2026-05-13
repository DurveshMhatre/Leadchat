// ============================================
// LeadChat API — Redis Service
// Client setup for session and matching queue
// ============================================

import Redis from 'ioredis';
import { config } from '../config/index.js';

/** Redis client for matching queue and session management */
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number | null {
    if (times > 10) {
      console.error('❌ Redis: Max reconnection attempts reached');
      return null;
    }
    // Exponential backoff: 200ms, 400ms, 800ms...
    const delay = Math.min(times * 200, 5_000);
    console.warn(`⚠️  Redis: Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  lazyConnect: false,
});

// Log Redis events
redis.on('connect', () => {
  console.log('🔴 Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

redis.on('close', () => {
  console.warn('⚠️  Redis connection closed');
});

/**
 * Check Redis connectivity.
 * Returns true if Redis is reachable.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    console.error('❌ Redis health check failed:', error);
    return false;
  }
}

/**
 * Gracefully close the Redis connection.
 * Called during server shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  await redis.quit();
  console.log('🔴 Redis connection closed');
}

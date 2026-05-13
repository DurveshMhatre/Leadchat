// ============================================
// LeadChat API — Health Check Route
// Used by Docker, load balancers, and monitoring
// ============================================

import { Router } from 'express';
import { checkDatabaseHealth } from '../services/database.js';
import { checkRedisHealth } from '../services/redis.js';

export const healthRouter = Router();

/**
 * GET /api/health
 * Returns the health status of the API and its dependencies.
 */
healthRouter.get('/health', async (_req, res) => {
  const [dbHealthy, redisHealthy] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const isHealthy = dbHealthy && redisHealthy;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected',
      },
      version: '0.1.0',
      environment: process.env['NODE_ENV'] ?? 'development',
    },
  });
});

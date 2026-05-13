// ============================================
// LeadChat API — PostgreSQL Database Service
// Connection pool setup with health check
// ============================================

import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

/** PostgreSQL connection pool */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log pool errors (never crash silently — global rule)
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Check database connectivity.
 * Returns true if the database is reachable.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

/**
 * Gracefully close the database pool.
 * Called during server shutdown.
 */
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
  console.log('🗄️  Database pool closed');
}

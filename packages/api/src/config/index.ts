// ============================================
// LeadChat API — Environment Configuration
// Validates all required env vars at startup
// ============================================

import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Load .env from monorepo root — try multiple locations
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const envSchema = z.object({
  // Database
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://leadchat:leadchat_dev@localhost:5432/leadchat'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Firebase (required for auth in Mission 4+)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),

  // Razorpay (Mission 5 — optional until then)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Server
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().default('change_me_in_production'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:8081'),

  // GST API — Setu (Mission 4)
  GST_API_CLIENT_ID: z.string().optional(),
  GST_API_CLIENT_SECRET: z.string().optional(),
  GST_API_URL: z.string().optional(),
});

function loadConfig(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }

  return parsed.data;
}

/** Validated and typed environment configuration */
export const config = loadConfig();

/** Type-safe config type for dependency injection */
export type AppConfig = typeof config;

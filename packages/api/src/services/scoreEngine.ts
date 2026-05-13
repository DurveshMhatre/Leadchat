// ============================================
// LeadChat API — AI Score Engine
// Computes aiScore (0-100) for every user
// Used by matching engine to weight visibility
// ============================================

import { pool } from './database.js';

// --- Score Breakdown Interface ---

export interface ScoreBreakdown {
  profileCompleteness: number;  // max 30
  verificationScore: number;    // max 35
  activityScore: number;        // max 20
  ratingScore: number;          // max 25
  total: number;                // clamped 0-100
}

// --- Badge Tiers ---

export type BadgeTier = 'top_rated' | 'verified_pro' | 'active' | 'none';

export interface BadgeInfo {
  tier: BadgeTier;
  label: string;
  color: string;
}

/**
 * Get badge info based on AI score.
 */
export function getBadgeForScore(score: number): BadgeInfo {
  if (score >= 90) return { tier: 'top_rated', label: 'Top Rated', color: 'gold' };
  if (score >= 70) return { tier: 'verified_pro', label: 'Verified Pro', color: 'blue' };
  if (score >= 50) return { tier: 'active', label: 'Active', color: 'green' };
  return { tier: 'none', label: '', color: '' };
}

// --- Profile Completeness (max 30 points) ---

/** Fields that count toward profile completeness */
const PROFILE_FIELDS = [
  'display_name',
  'industry',
  'phone',
  'email',
  'service_type',
  'tagline',
  'budget_min',
  'budget_max',
  'portfolio_url',
  'avatar_url',
] as const;

function computeProfileCompleteness(user: Record<string, unknown>): number {
  let filled = 0;
  for (const field of PROFILE_FIELDS) {
    const value = user[field];
    if (value !== null && value !== undefined && value !== '') {
      filled++;
    }
  }
  const ratio = filled / PROFILE_FIELDS.length;
  return Math.round(ratio * 30);
}

// --- Verification Score (max 35 points) ---

interface VerificationFlags {
  verified: boolean;       // Level 1: Phone OTP (baseline)
  emailVerified: boolean;  // Level 2: Business email (+10)
  gstVerified: boolean;    // Level 3: GST validated (+20)
  portfolioVerified: boolean; // Level 4: Portfolio reachable (+5)
}

function computeVerificationScore(flags: VerificationFlags): number {
  let score = 0;
  // Level 1 is baseline — no bonus (everyone must have it)
  if (flags.emailVerified) score += 10;
  if (flags.gstVerified) score += 20;
  if (flags.portfolioVerified) score += 5;
  return score;
}

// --- Activity Score (max 20 points) ---

function computeActivityScore(totalChats: number): number {
  return Math.min(totalChats * 2, 20);
}

// --- Rating Score (max 25 points) ---

function computeRatingScore(avgRating: number): number {
  if (avgRating <= 0) return 0;
  // (avgRating - 1) / 4 * 25
  // Rating 1 = 0 points, Rating 5 = 25 points
  return Math.round(((avgRating - 1) / 4) * 25);
}

// --- Main Computation ---

/**
 * Compute the full AI score breakdown for a user.
 */
export function computeScoreBreakdown(
  user: Record<string, unknown>,
  flags: VerificationFlags,
): ScoreBreakdown {
  const profileCompleteness = computeProfileCompleteness(user);
  const verificationScore = computeVerificationScore(flags);
  const activityScore = computeActivityScore(Number(user['total_chats'] ?? 0));
  const ratingScore = computeRatingScore(Number(user['rating'] ?? 0));

  let raw = profileCompleteness + verificationScore + activityScore + ratingScore;
  
  // Premium priority multiplier (Mission 5)
  const isPremium = user['tier'] === 'premium' && 
    (!user['tier_expires_at'] || new Date(String(user['tier_expires_at'])) > new Date());
  
  if (isPremium) {
    raw = raw * 1.5;
  }

  const total = Math.round(Math.max(0, Math.min(100, raw)));

  return {
    profileCompleteness,
    verificationScore,
    activityScore,
    ratingScore,
    total,
  };
}

/**
 * Recompute and persist the AI score for a user.
 * Called after profile update, verification, or rating change.
 * Returns the new score breakdown.
 */
export async function recomputeAndSaveScore(userId: string): Promise<ScoreBreakdown> {
  // Fetch current user data
  const userResult = await pool.query(
    `SELECT * FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const flags: VerificationFlags = {
    verified: user.verified,
    emailVerified: user.email_verified,
    gstVerified: user.gst_verified,
    portfolioVerified: user.portfolio_verified,
  };

  const breakdown = computeScoreBreakdown(user, flags);
  const oldScore = user.ai_score;

  // Update user's ai_score
  await pool.query(
    `UPDATE users SET ai_score = $1 WHERE id = $2`,
    [breakdown.total, userId],
  );

  // Also update profile_complete flag
  const isComplete = breakdown.profileCompleteness >= 24; // 80% of 30 = 24
  await pool.query(
    `UPDATE users SET profile_complete = $1 WHERE id = $2`,
    [isComplete, userId],
  );

  // Log to score history for auditing
  await pool.query(
    `INSERT INTO ai_score_history (user_id, old_score, new_score, breakdown)
     VALUES ($1, $2, $3, $4)`,
    [userId, oldScore, breakdown.total, JSON.stringify(breakdown)],
  );

  return breakdown;
}

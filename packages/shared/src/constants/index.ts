// ============================================
// LeadChat Shared Constants
// Industry data, budget presets, feature gates
// ============================================

import type { Industry, SubscriptionTier } from '../types/index.js';

// --- Industry Configuration ---

export interface IndustryConfig {
  /** Industry key used in code */
  key: Industry;
  /** Display name shown in UI */
  label: string;
  /** Emoji icon for room cards */
  icon: string;
  /** Short description for tooltips */
  description: string;
}

export const INDUSTRIES: readonly IndustryConfig[] = [
  { key: 'technology', label: 'Technology', icon: '💻', description: 'Software, IT services, SaaS' },
  { key: 'design', label: 'Design', icon: '🎨', description: 'UI/UX, graphic design, branding' },
  { key: 'marketing', label: 'Marketing', icon: '📢', description: 'Digital marketing, SEO, content' },
  { key: 'finance', label: 'Finance', icon: '💰', description: 'Accounting, tax, financial advisory' },
  { key: 'legal', label: 'Legal', icon: '⚖️', description: 'Corporate law, compliance, IP' },
  {
    key: 'construction',
    label: 'Construction',
    icon: '🏗️',
    description: 'Architecture, interior, civil',
  },
  { key: 'retail', label: 'Retail', icon: '🛍️', description: 'E-commerce, wholesale, distribution' },
  { key: 'education', label: 'Education', icon: '📚', description: 'EdTech, training, coaching' },
  { key: 'healthcare', label: 'Healthcare', icon: '🏥', description: 'Pharma, medical devices, clinics' },
  {
    key: 'hospitality',
    label: 'Hospitality',
    icon: '🏨',
    description: 'Hotels, restaurants, travel',
  },
  { key: 'other', label: 'Other', icon: '🔧', description: 'Other professional services' },
] as const;

/** Quick lookup: industry key → config */
export const INDUSTRY_MAP: ReadonlyMap<Industry, IndustryConfig> = new Map(
  INDUSTRIES.map((ind) => [ind.key, ind]),
);

// --- Budget Presets (INR) ---

export interface BudgetPreset {
  label: string;
  min: number;
  max: number;
}

/** Realistic Indian market budget ranges */
export const BUDGET_PRESETS: readonly BudgetPreset[] = [
  { label: 'Under ₹50K', min: 0, max: 50_000 },
  { label: '₹50K – ₹1L', min: 50_000, max: 100_000 },
  { label: '₹1L – ₹3L', min: 100_000, max: 300_000 },
  { label: '₹3L – ₹5L', min: 300_000, max: 500_000 },
  { label: '₹5L – ₹10L', min: 500_000, max: 1_000_000 },
  { label: '₹10L – ₹25L', min: 1_000_000, max: 2_500_000 },
  { label: '₹25L – ₹50L', min: 2_500_000, max: 5_000_000 },
  { label: '₹50L+', min: 5_000_000, max: Number.MAX_SAFE_INTEGER },
] as const;

// --- Feature Gate Map (Mission 5) ---

export interface FeatureGate {
  feature: string;
  free: string | number | boolean;
  premium: string | number | boolean;
}

/** Feature gates enforced by SubscriptionMiddleware */
export const FEATURE_GATES: Record<string, Record<SubscriptionTier, number | boolean>> = {
  matchesPerDay: { free: 5, premium: Infinity },
  filterByBudget: { free: false, premium: true },
  filterByRating: { free: false, premium: true },
  dealRoomAccess: { free: false, premium: true },
  savedContactsLimit: { free: 3, premium: Infinity },
  priorityQueue: { free: false, premium: true },
} as const;

// --- Matching Engine Constants ---

/** How often the matching cycle runs (milliseconds) */
export const MATCHING_CYCLE_INTERVAL_MS = 3_000;

/** Time before a user is auto-removed from the queue (seconds) */
export const QUEUE_TTL_SECONDS = 300;

/** Initial match timeout — widen search radius after this (seconds) */
export const MATCH_TIMEOUT_SOFT_SECONDS = 90;

/** Final match timeout — show 'low traffic' message (seconds) */
export const MATCH_TIMEOUT_HARD_SECONDS = 150;

/** Priority queue score multiplier for premium users */
export const PREMIUM_SCORE_WEIGHT = 1.5;

// --- Scoring Constants ---

/** Maximum AI score */
export const MAX_AI_SCORE = 100;

/** Minimum AI score */
export const MIN_AI_SCORE = 0;

/** Score weights for AI computation */
export const SCORE_WEIGHTS = {
  profileCompleteness: 30,
  verification: 25,
  activity: 20,
  rating: 25,
} as const;

// --- Credit System ---

/** Price per lead credit save (INR) */
export const CREDIT_PRICE_PER_SAVE = 49;

/** Credit pack options */
export const CREDIT_PACKS = [
  { credits: 10, price: 399, label: '10 Credits' },
  { credits: 25, price: 799, label: '25 Credits' },
] as const;

/** Premium subscription price (INR/month) */
export const PREMIUM_MONTHLY_PRICE = 999;

// --- Validation Constants ---

/** Indian phone number regex (+91 followed by 10 digits) */
export const INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;

/** GST number format regex */
export const GST_NUMBER_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

/** Maximum review note length */
export const MAX_REVIEW_NOTE_LENGTH = 120;

/** Maximum quick pitch tagline length */
export const MAX_TAGLINE_LENGTH = 100;

// --- Score Badge Thresholds ---

export type BadgeType = 'top_rated' | 'verified_pro' | 'active' | 'none';

export interface BadgeConfig {
  type: BadgeType;
  label: string;
  color: string;
  minScore: number;
  maxScore: number;
}

export const SCORE_BADGES: readonly BadgeConfig[] = [
  { type: 'top_rated', label: 'Top Rated', color: '#FFD700', minScore: 90, maxScore: 100 },
  { type: 'verified_pro', label: 'Verified Pro', color: '#1A56DB', minScore: 70, maxScore: 89 },
  { type: 'active', label: 'Active', color: '#22C55E', minScore: 50, maxScore: 69 },
  { type: 'none', label: '', color: 'transparent', minScore: 0, maxScore: 49 },
] as const;

/** Get badge for a given AI score */
export function getBadgeForScore(score: number): BadgeConfig {
  const badge = SCORE_BADGES.find((b) => score >= b.minScore && score <= b.maxScore);
  // Score 0-49 always matches 'none' badge
  return badge ?? SCORE_BADGES[SCORE_BADGES.length - 1]!;
}

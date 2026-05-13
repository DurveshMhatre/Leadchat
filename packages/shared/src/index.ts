// ============================================
// @leadchat/shared — Public API
// Re-exports all types and constants
// ============================================

// Types
export type {
  Industry,
  BudgetRange,
  UserRole,
  SubscriptionTier,
  User,
  PublicProfile,
  MatchStatus,
  Match,
  MessageType,
  ChatMessage,
  DealStatus,
  PaymentStatus,
  MilestoneStatus,
  DealRoom,
  Milestone,
  Rating,
  ClientToServerEvents,
  ServerToClientEvents,
  ApiResponse,
  PaginatedResponse,
} from './types/index.js';

// Constants
export {
  INDUSTRIES,
  INDUSTRY_MAP,
  BUDGET_PRESETS,
  FEATURE_GATES,
  MATCHING_CYCLE_INTERVAL_MS,
  QUEUE_TTL_SECONDS,
  MATCH_TIMEOUT_SOFT_SECONDS,
  MATCH_TIMEOUT_HARD_SECONDS,
  PREMIUM_SCORE_WEIGHT,
  MAX_AI_SCORE,
  MIN_AI_SCORE,
  SCORE_WEIGHTS,
  CREDIT_PRICE_PER_SAVE,
  CREDIT_PACKS,
  PREMIUM_MONTHLY_PRICE,
  INDIAN_PHONE_REGEX,
  GST_NUMBER_REGEX,
  MAX_REVIEW_NOTE_LENGTH,
  MAX_TAGLINE_LENGTH,
  SCORE_BADGES,
  getBadgeForScore,
} from './constants/index.js';

export type { IndustryConfig, BudgetPreset, FeatureGate, BadgeType, BadgeConfig } from './constants/index.js';

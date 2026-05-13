// ============================================
// LeadChat Shared Types
// All types used across mobile + API packages
// ============================================

// --- User Types ---

/**
 * Industry categories available on LeadChat.
 * Used for room-based matching and profile categorisation.
 */
export type Industry =
  | 'technology'
  | 'design'
  | 'marketing'
  | 'finance'
  | 'legal'
  | 'construction'
  | 'retail'
  | 'education'
  | 'healthcare'
  | 'hospitality'
  | 'other';

/**
 * Budget range in INR — used by buyers to indicate project budget
 * and by providers to indicate typical rate.
 */
export interface BudgetRange {
  /** Minimum amount in INR */
  min: number;
  /** Maximum amount in INR */
  max: number;
  /** Currency — INR only (India-specific default) */
  currency: 'INR';
}

/**
 * User role — LeadChat treats both symmetrically.
 * Either side can skip or save.
 */
export type UserRole = 'buyer' | 'provider';

/**
 * User subscription tier for feature gating.
 */
export type SubscriptionTier = 'free' | 'premium';

/**
 * Core user profile — both buyers and providers share this shape.
 */
export interface User {
  /** Unique identifier (UUID) */
  id: string;
  /** User role: buyer seeking services or provider offering them */
  role: UserRole;
  /** Display name shown in chat and on pitch cards */
  displayName: string;
  /** Primary industry the user operates in */
  industry: Industry;
  /** Phone number with +91 prefix (India-specific) */
  phone: string;
  /** Business email (optional, used for verification level 2) */
  email?: string;
  /** GST number (optional, used for verification level 3) */
  gstNumber?: string;
  /** Service type description — providers only */
  serviceType?: string;
  /** 1-line tagline for the quick pitch card */
  tagline?: string;
  /** Budget/rate range — buyers set budget, providers set rate */
  budget?: BudgetRange;
  /** Portfolio URL (optional, verification level 4) */
  portfolioUrl?: string;
  /** Profile image URL in Firebase Storage */
  avatarUrl?: string;
  /** AI-computed trust score (0-100), used to weight matching */
  aiScore: number;
  /** Whether phone OTP has been verified (verification level 1) */
  verified: boolean;
  /** Whether profile is >80% complete */
  profileComplete: boolean;
  /** Average rating from post-chat reviews (1-5) */
  rating: number;
  /** Total number of chats completed */
  totalChats: number;
  /** Subscription tier for feature gating */
  tier: SubscriptionTier;
  /** Lead credit balance for pay-per-save model */
  creditBalance: number;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Safe public-facing user profile — excludes sensitive fields.
 * Shown on QuickPitchCard and public profile views.
 */
export interface PublicProfile {
  id: string;
  role: UserRole;
  displayName: string;
  industry: Industry;
  serviceType?: string;
  tagline?: string;
  budget?: BudgetRange;
  portfolioUrl?: string;
  avatarUrl?: string;
  aiScore: number;
  verified: boolean;
  profileComplete: boolean;
  rating: number;
  totalChats: number;
}

// --- Match Types ---

/**
 * Match status lifecycle:
 * active → saved (one side) → deal (both sides) OR skipped
 */
export type MatchStatus = 'active' | 'saved' | 'skipped' | 'deal';

/**
 * A match between a buyer and provider in the same industry room.
 */
export interface Match {
  /** Unique match identifier (UUID) */
  id: string;
  /** The buyer in this match */
  buyerId: string;
  /** The provider in this match */
  providerId: string;
  /** Industry room where the match occurred */
  industry: Industry;
  /** AI-computed compatibility score (0-100) */
  matchScore: number;
  /** Current status of the match */
  status: MatchStatus;
  /** Whether the buyer has saved this match */
  buyerSaved: boolean;
  /** Whether the provider has saved this match */
  providerSaved: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

// --- Chat Types ---

/** Message content type */
export type MessageType = 'text' | 'voice' | 'file' | 'system';

/**
 * A single chat message within a match conversation.
 */
export interface ChatMessage {
  /** Unique message identifier (UUID) */
  id: string;
  /** Match this message belongs to */
  matchId: string;
  /** User who sent this message */
  senderId: string;
  /** Message content (text, file URL, or system message) */
  content: string;
  /** Type of message */
  type: MessageType;
  /** ISO 8601 timestamp when the message was read */
  readAt?: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

// --- Deal Room Types ---

/** Deal status progression */
export type DealStatus = 'active' | 'completed' | 'archived';

/** Payment status for deal tracking */
export type PaymentStatus = 'pending' | 'partial' | 'paid';

/** Milestone status for deal task tracking */
export type MilestoneStatus = 'todo' | 'in_progress' | 'done';

/**
 * Deal Room — workspace for matched pairs who have both saved each other.
 */
export interface DealRoom {
  /** Unique deal room identifier (UUID) */
  id: string;
  /** The originating match */
  matchId: string;
  /** Buyer user ID */
  buyerId: string;
  /** Provider user ID */
  providerId: string;
  /** Current deal status */
  status: DealStatus;
  /** Payment tracking status */
  paymentStatus: PaymentStatus;
  /** Whether review has been triggered */
  reviewTriggered: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * A milestone within a deal room for task tracking.
 */
export interface Milestone {
  id: string;
  dealRoomId: string;
  title: string;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

// --- Rating Types ---

/**
 * Post-chat/deal rating submitted by one party.
 * Both sides rate independently. Visible after both submit.
 */
export interface Rating {
  /** Unique rating identifier (UUID) */
  id: string;
  /** Match this rating is for */
  matchId: string;
  /** User submitting the rating */
  raterId: string;
  /** User being rated */
  ratedUserId: string;
  /** Rating score (1-5 stars) */
  score: number;
  /** Optional review note (max 120 chars) */
  note?: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

// --- Socket Event Types ---

/** Client → Server socket events */
export interface ClientToServerEvents {
  'join:room': (data: { industry: Industry; role: UserRole; userId: string }) => void;
  'leave:room': () => void;
  'chat:send': (data: { matchId: string; content: string; type: MessageType }) => void;
  'chat:typing': (data: { matchId: string }) => void;
  'match:skip': (data: { matchId: string }) => void;
  'match:save': (data: { matchId: string }) => void;
}

/** Server → Client socket events */
export interface ServerToClientEvents {
  'match:found': (data: { matchId: string; partner: PublicProfile }) => void;
  'match:timeout': (data: { reason: string }) => void;
  'chat:received': (data: { message: ChatMessage }) => void;
  'partner:left': () => void;
  'partner:typing': () => void;
  'match:saved': (data: { matchId: string; savedBy: string }) => void;
  'deal:created': (data: { dealRoomId: string; matchId: string }) => void;
  'error': (data: { code: string; message: string }) => void;
}

// --- API Response Types ---

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

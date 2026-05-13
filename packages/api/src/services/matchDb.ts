// ============================================
// LeadChat API — Match Database Operations
// PostgreSQL queries for matching, chat, deals
// ============================================

import { randomUUID } from 'node:crypto';
import type { PublicProfile, Industry, MatchStatus, MessageType } from '@leadchat/shared';
import { pool } from './database.js';

// --- User Queries ---

/**
 * Fetch a user by their Firebase UID.
 * Used when a socket connects with a userId (firebase_uid).
 */
export async function getUserByFirebaseUid(firebaseUid: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT * FROM users WHERE firebase_uid = $1`,
    [firebaseUid],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch a user by their internal UUID.
 */
export async function getUserById(userId: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT * FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Build a safe PublicProfile from a database row.
 * Excludes sensitive fields like phone, email, GST number.
 */
export function toPublicProfile(row: UserRow): PublicProfile {
  return {
    id: row.id,
    role: row.role as 'buyer' | 'provider',
    displayName: row.display_name,
    industry: row.industry as Industry,
    serviceType: row.service_type ?? undefined,
    tagline: row.tagline ?? undefined,
    budget: row.budget_min != null && row.budget_max != null
      ? { min: row.budget_min, max: row.budget_max, currency: 'INR' as const }
      : undefined,
    portfolioUrl: row.portfolio_url ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    aiScore: row.ai_score,
    verified: row.verified,
    profileComplete: row.profile_complete,
    rating: Number(row.rating),
    totalChats: row.total_chats,
  };
}

// --- Match Queries ---

/**
 * Create a new match record in PostgreSQL.
 * Returns the match ID.
 */
export async function createMatch(
  buyerId: string,
  providerId: string,
  industry: Industry,
  matchScore: number,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO matches (id, buyer_id, provider_id, industry, match_score, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     ON CONFLICT (buyer_id, provider_id) DO NOTHING`,
    [id, buyerId, providerId, industry, matchScore],
  );
  return id;
}

/**
 * Update match status.
 */
export async function updateMatchStatus(matchId: string, status: MatchStatus): Promise<void> {
  await pool.query(
    `UPDATE matches SET status = $1 WHERE id = $2`,
    [status, matchId],
  );
}

/**
 * Set buyer_saved or provider_saved flag on a match.
 * Returns { buyerSaved, providerSaved } after update.
 */
export async function setMatchSaved(
  matchId: string,
  role: 'buyer' | 'provider',
): Promise<{ buyerSaved: boolean; providerSaved: boolean } | null> {
  const column = role === 'buyer' ? 'buyer_saved' : 'provider_saved';
  const result = await pool.query<{ buyer_saved: boolean; provider_saved: boolean }>(
    `UPDATE matches SET ${column} = true, status = 'saved'
     WHERE id = $1
     RETURNING buyer_saved, provider_saved`,
    [matchId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { buyerSaved: row.buyer_saved, providerSaved: row.provider_saved };
}

/**
 * Get match by ID.
 */
export async function getMatchById(matchId: string): Promise<MatchRow | null> {
  const result = await pool.query<MatchRow>(
    `SELECT * FROM matches WHERE id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

/**
 * Check if two users have previously been matched.
 * Used by the hard filter to prevent re-matches.
 */
export async function havePreviouslyMatched(userId1: string, userId2: string): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM matches
     WHERE (buyer_id = $1 AND provider_id = $2)
        OR (buyer_id = $2 AND provider_id = $1)`,
    [userId1, userId2],
  );
  const count = parseInt(result.rows[0]?.count ?? '0', 10);
  return count > 0;
}

/**
 * Get all user IDs that a user has blocked.
 */
export async function getBlockedUserIds(userId: string): Promise<Set<string>> {
  const result = await pool.query<{ blocked_id: string }>(
    `SELECT blocked_id FROM blocked_users WHERE blocker_id = $1`,
    [userId],
  );
  return new Set(result.rows.map((r) => r.blocked_id));
}

// --- Chat Queries ---

/**
 * Save a chat message to PostgreSQL.
 * Returns the created message.
 */
export async function saveMessage(
  matchId: string,
  senderId: string,
  content: string,
  type: MessageType,
): Promise<MessageRow> {
  const id = randomUUID();
  const result = await pool.query<MessageRow>(
    `INSERT INTO chat_messages (id, match_id, sender_id, content, type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, matchId, senderId, content, type],
  );
  // INSERT RETURNING always gives a row — non-null assertion explained here
  return result.rows[0]!; // Safe: INSERT...RETURNING always returns the inserted row
}

/**
 * Increment total_chats counter for a user.
 */
export async function incrementTotalChats(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET total_chats = total_chats + 1 WHERE id = $1`,
    [userId],
  );
}

// --- Deal Room Queries ---

/**
 * Create a deal room after both parties save each other.
 * Returns the deal room ID.
 */
export async function createDealRoom(
  matchId: string,
  buyerId: string,
  providerId: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO deal_rooms (id, match_id, buyer_id, provider_id)
     VALUES ($1, $2, $3, $4)`,
    [id, matchId, buyerId, providerId],
  );

  // Update match status to 'deal'
  await updateMatchStatus(matchId, 'deal');

  return id;
}

// --- Row Types ---

/** Database row shape for users table */
export interface UserRow {
  id: string;
  firebase_uid: string;
  role: string;
  display_name: string;
  industry: string;
  phone: string;
  email: string | null;
  gst_number: string | null;
  service_type: string | null;
  tagline: string | null;
  budget_min: number | null;
  budget_max: number | null;
  portfolio_url: string | null;
  avatar_url: string | null;
  ai_score: number;
  verified: boolean;
  profile_complete: boolean;
  rating: number;
  total_chats: number;
  tier: string;
  credit_balance: number;
  tier_expires_at: string | null;
  email_verified: boolean;
  gst_verified: boolean;
  portfolio_verified: boolean;
  created_at: string;
  updated_at: string;
}

/** Database row shape for matches table */
export interface MatchRow {
  id: string;
  buyer_id: string;
  provider_id: string;
  industry: string;
  match_score: number;
  status: string;
  buyer_saved: boolean;
  provider_saved: boolean;
  created_at: string;
  updated_at: string;
}

/** Database row shape for chat_messages table */
export interface MessageRow {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  type: string;
  read_at: string | null;
  created_at: string;
}

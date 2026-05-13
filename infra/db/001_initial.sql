-- ============================================
-- LeadChat — Initial Database Schema
-- Run: docker exec -i leadchat-postgres psql -U leadchat -d leadchat  < infra/db/001_initial.sql
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- Core profile for both buyers and providers
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid    VARCHAR(128) UNIQUE NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('buyer', 'provider')),
    display_name    VARCHAR(100) NOT NULL,
    industry        VARCHAR(50) NOT NULL CHECK (industry IN (
                        'technology', 'design', 'marketing', 'finance',
                        'legal', 'construction', 'retail', 'education',
                        'healthcare', 'hospitality', 'other'
                    )),
    phone           VARCHAR(15) NOT NULL,
    email           VARCHAR(255),
    gst_number      VARCHAR(15),
    service_type    VARCHAR(200),       -- Providers only
    tagline         VARCHAR(100),       -- Quick pitch tagline
    budget_min      INTEGER,            -- INR
    budget_max      INTEGER,            -- INR
    portfolio_url   VARCHAR(500),
    avatar_url      VARCHAR(500),
    ai_score        SMALLINT NOT NULL DEFAULT 0 CHECK (ai_score >= 0 AND ai_score <= 100),
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    profile_complete BOOLEAN NOT NULL DEFAULT FALSE,
    rating          NUMERIC(2,1) NOT NULL DEFAULT 0.0 CHECK (rating >= 0 AND rating <= 5),
    total_chats     INTEGER NOT NULL DEFAULT 0,
    tier            VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
    credit_balance  INTEGER NOT NULL DEFAULT 0,
    tier_expires_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_industry ON users(industry);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_ai_score ON users(ai_score DESC);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);

-- ============================================
-- MATCHES TABLE
-- Records every match between a buyer and provider
-- ============================================
CREATE TABLE IF NOT EXISTS matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    industry        VARCHAR(50) NOT NULL,
    match_score     SMALLINT NOT NULL DEFAULT 50 CHECK (match_score >= 0 AND match_score <= 100),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'saved', 'skipped', 'deal')),
    buyer_saved     BOOLEAN NOT NULL DEFAULT FALSE,
    provider_saved  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate matches between same pair
    CONSTRAINT unique_match_pair UNIQUE (buyer_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_buyer ON matches(buyer_id);
CREATE INDEX IF NOT EXISTS idx_matches_provider ON matches(provider_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

-- ============================================
-- CHAT MESSAGES TABLE
-- Message history for each match conversation
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    type            VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'voice', 'file', 'system')),
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_match ON chat_messages(match_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(match_id, created_at DESC);

-- ============================================
-- DEAL ROOMS TABLE
-- Workspace opened after both parties save each other
-- ============================================
CREATE TABLE IF NOT EXISTS deal_rooms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    payment_status  VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
    review_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_rooms_buyer ON deal_rooms(buyer_id);
CREATE INDEX IF NOT EXISTS idx_deal_rooms_provider ON deal_rooms(provider_id);

-- ============================================
-- MILESTONES TABLE
-- Simple task tracker within deal rooms
-- ============================================
CREATE TABLE IF NOT EXISTS milestones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_room_id    UUID NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_deal_room ON milestones(deal_room_id);

-- ============================================
-- RATINGS TABLE
-- Post-chat/deal ratings (both sides rate independently)
-- ============================================
CREATE TABLE IF NOT EXISTS ratings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    rater_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rated_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score           SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
    note            VARCHAR(120),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Each user can only rate once per match
    CONSTRAINT unique_rating_per_match UNIQUE (match_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_rated_user ON ratings(rated_user_id);

-- ============================================
-- PROPOSALS TABLE
-- Uploaded documents within deal rooms
-- ============================================
CREATE TABLE IF NOT EXISTS proposals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_room_id    UUID NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
    uploader_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_url        VARCHAR(500) NOT NULL,
    file_type       VARCHAR(50) NOT NULL,
    file_size       INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_deal_room ON proposals(deal_room_id);

-- ============================================
-- BILLING TABLE
-- Subscription and credit purchase records
-- ============================================
CREATE TABLE IF NOT EXISTS billing_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('subscription', 'credits')),
    amount          INTEGER NOT NULL,           -- INR (paise)
    razorpay_order_id   VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_transactions(user_id);

-- ============================================
-- BLOCKED USERS TABLE
-- Prevent re-matching with blocked users
-- ============================================
CREATE TABLE IF NOT EXISTS blocked_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users(blocker_id);

-- ============================================
-- AUTO-UPDATE TIMESTAMPS TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['users', 'matches', 'deal_rooms', 'milestones'])
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER update_%I_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            tbl, tbl
        );
    END LOOP;
END $$;

-- ============================================
-- SEED DATA (Realistic Indian business names — no lorem ipsum)
-- ============================================
-- Seed data will be added via a separate script for testing
-- Example entries (not inserted here):
--   'Riya Designs' — UI/UX Studio, Budget: ₹1L–₹3L
--   'TechVault Solutions' — Full-stack development, Rate: ₹80K–₹2L
--   'GreenLeaf Marketing' — Digital marketing agency
--   'Sharma & Associates' — Corporate law firm

-- ============================================
-- LeadChat — Mission 4: Verification Schema
-- ============================================

CREATE TABLE IF NOT EXISTS user_verifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level           VARCHAR(20) NOT NULL CHECK (level IN ('phone', 'email', 'gst', 'portfolio')),
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB,  -- e.g. { "legalName": "...", "gstStatus": "Active" } for GST
    CONSTRAINT unique_verification UNIQUE (user_id, level)
);

CREATE INDEX IF NOT EXISTS idx_verifications_user ON user_verifications(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_score_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_score       SMALLINT NOT NULL,
    new_score       SMALLINT NOT NULL,
    breakdown       JSONB NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_history_user ON ai_score_history(user_id);

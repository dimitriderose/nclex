-- NCLEX Trainer v5 - Initial Schema
-- All tables use UUID primary keys and timestamptz for timestamps

-- Users table
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20)  NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
    token_version   INTEGER      NOT NULL DEFAULT 0,
    deletion_requested_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);

-- User stats (JSONB for flexible topic scores and history)
CREATE TABLE user_stats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    topic_scores    JSONB NOT NULL DEFAULT '{}',
    history         JSONB NOT NULL DEFAULT '[]',
    streak          INTEGER NOT NULL DEFAULT 0,
    readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ncjmm_scores    JSONB NOT NULL DEFAULT '{}',
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_stats_user_id ON user_stats (user_id);

-- Flagged questions
CREATE TABLE flagged_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic           VARCHAR(255) NOT NULL,
    question        JSONB NOT NULL,
    category        VARCHAR(50) NOT NULL CHECK (category IN ('REVIEW', 'WRONG', 'BOOKMARK', 'HARD')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flagged_questions_user_id ON flagged_questions (user_id);
CREATE INDEX idx_flagged_questions_user_category ON flagged_questions (user_id, category);
CREATE INDEX idx_flagged_questions_user_topic ON flagged_questions (user_id, topic);

-- Reading positions (track where user left off in content)
CREATE TABLE reading_positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_key     VARCHAR(255) NOT NULL,
    position        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, content_key)
);

CREATE INDEX idx_reading_positions_user_id ON reading_positions (user_id);

-- Content cache (server-side caching with TTL)
CREATE TABLE content_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_key     VARCHAR(512) NOT NULL UNIQUE,
    source          VARCHAR(100) NOT NULL,
    data            JSONB NOT NULL,
    ttl_days        INTEGER NOT NULL DEFAULT 7,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_cache_key ON content_cache (content_key);
CREATE INDEX idx_content_cache_expires ON content_cache (expires_at);

-- Audit log
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(100) NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    ip_address      VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_user_id ON audit_log (user_id);
CREATE INDEX idx_audit_log_event_type ON audit_log (event_type);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);

-- WebAuthn credentials (passkeys)
CREATE TABLE webauthn_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   TEXT NOT NULL UNIQUE,
    public_key      TEXT NOT NULL,
    sign_count      BIGINT NOT NULL DEFAULT 0,
    device_name     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_webauthn_credentials_user_id ON webauthn_credentials (user_id);
CREATE INDEX idx_webauthn_credentials_credential_id ON webauthn_credentials (credential_id);

-- Phase 3: Question Reports
CREATE TABLE IF NOT EXISTS question_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_topic VARCHAR(255) NOT NULL,
    question_data JSONB NOT NULL DEFAULT '{}',
    report_reason VARCHAR(500) NOT NULL,
    user_notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_question_reports_status ON question_reports(status);
CREATE INDEX idx_question_reports_user ON question_reports(user_id);
CREATE INDEX idx_question_reports_created ON question_reports(created_at DESC);

-- Phase 3: Readiness Snapshots
CREATE TABLE IF NOT EXISTS readiness_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    readiness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    readiness_band VARCHAR(20) NOT NULL DEFAULT 'low',
    topic_breakdown JSONB NOT NULL DEFAULT '{}',
    ncjmm_breakdown JSONB NOT NULL DEFAULT '{}',
    questions_answered INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, snapshot_date)
);

CREATE INDEX idx_readiness_snapshots_user_date ON readiness_snapshots(user_id, snapshot_date DESC);

-- Phase 3: Exam Sessions (CAT mode)
CREATE TABLE IF NOT EXISTS exam_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    total_questions INT NOT NULL DEFAULT 0,
    correct_count INT NOT NULL DEFAULT 0,
    current_difficulty DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    question_history JSONB NOT NULL DEFAULT '[]',
    topic_breakdown JSONB NOT NULL DEFAULT '{}',
    time_limit_minutes INT NOT NULL DEFAULT 300,
    elapsed_seconds BIGINT NOT NULL DEFAULT 0,
    pass_prediction BOOLEAN,
    confidence_level DOUBLE PRECISION,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exam_sessions_user ON exam_sessions(user_id);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(user_id, status);

-- Add admin query indexes to existing tables
CREATE INDEX IF NOT EXISTS idx_audit_log_event_created ON audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email_search ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_last_active ON user_stats(last_active_at);
CREATE INDEX IF NOT EXISTS idx_content_cache_source ON content_cache(source);

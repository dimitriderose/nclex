-- Shared persistent question bank: lets Practice mode, the offline bank, spaced-repetition
-- review, and the exam simulator all draw from (and grow) one durable pool instead of
-- generating throwaway questions per request.
CREATE TABLE generated_questions (
    id               UUID         PRIMARY KEY,
    topic            VARCHAR(255) NOT NULL,
    question_type    VARCHAR(50)  NOT NULL,
    difficulty       VARCHAR(20)  NOT NULL,
    ncjmm_step       VARCHAR(100),
    stem             TEXT         NOT NULL,
    options          JSONB        NOT NULL,
    correct_answer   JSONB        NOT NULL,
    rationale        TEXT         NOT NULL,
    source           VARCHAR(255),
    content_hash     VARCHAR(64)  NOT NULL UNIQUE,
    usage_count      INTEGER      NOT NULL DEFAULT 0,
    created_at       TIMESTAMP    DEFAULT NOW(),
    last_used_at     TIMESTAMP
);

-- Covering index: supports the bank-first lookup's equality filter (topic, question_type,
-- difficulty) AND its "prefer least-used" ordering (usage_count) without a heap fetch/sort.
CREATE INDEX idx_generated_questions_bank_lookup
    ON generated_questions (topic, question_type, difficulty, usage_count)
    INCLUDE (id, last_used_at);

-- Per-user attempt log. Intentionally allows multiple rows per (user_id, question_id):
-- spaced-repetition re-review and "track attempts on a question over time" both require it.
-- question_id has NO ON DELETE action (defaults to RESTRICT) — there is currently no delete
-- path at all for generated_questions rows (no soft-delete column, no service-layer delete
-- logic), so this can never fire; it exists purely as a defensive guard against a hypothetical
-- future DELETE silently destroying attempt history/analytics.
-- source discriminates which mode produced the attempt ('practice' | 'exam') so Phase 5's
-- exam integration can write into the same table instead of forking a parallel history scheme.
CREATE TABLE question_attempts (
    id           UUID         PRIMARY KEY,
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id  UUID         NOT NULL REFERENCES generated_questions(id),
    correct      BOOLEAN      NOT NULL,
    source       VARCHAR(20)  NOT NULL DEFAULT 'practice',
    attempted_at TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX idx_question_attempts_user_question ON question_attempts(user_id, question_id);

-- Durable SM-2 spaced-repetition state, replacing localStorage['nclex:sm2_data'] as the
-- source of truth. question_id links a flag back to its bank row (nullable + ON DELETE SET NULL
-- since older flags predate the bank and store full question content inline as JSONB).
ALTER TABLE flagged_questions
    ADD COLUMN question_id      UUID REFERENCES generated_questions(id) ON DELETE SET NULL,
    ADD COLUMN next_review_date TIMESTAMP,
    ADD COLUMN easiness_factor  DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    ADD COLUMN repetition_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN interval_days    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_reviewed_at TIMESTAMP;

-- Matches the (user_id, ...) convention of every existing flagged_questions index, so one
-- user's review backlog can't dominate scans for everyone; range-scans pre-sorted by due date.
CREATE INDEX idx_flagged_questions_user_next_review ON flagged_questions (user_id, next_review_date);

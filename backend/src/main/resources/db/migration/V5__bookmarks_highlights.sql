CREATE TABLE bookmarks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_key     VARCHAR(255) NOT NULL,
    page            INTEGER NOT NULL,
    label           VARCHAR(255),
    client_id       VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(user_id, content_key, page)
);
CREATE INDEX idx_bookmarks_user_content ON bookmarks(user_id, content_key);

CREATE TABLE highlights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_key     VARCHAR(255) NOT NULL,
    client_id       VARCHAR(100) NOT NULL UNIQUE,
    color           VARCHAR(10) NOT NULL CHECK (color IN ('yellow','green','blue','pink')),
    text            TEXT NOT NULL,
    note            TEXT,
    start_xpath     TEXT NOT NULL,
    start_offset    INTEGER NOT NULL,
    end_xpath       TEXT NOT NULL,
    end_offset      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_highlights_user_content ON highlights(user_id, content_key);

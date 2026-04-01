-- Add search and bulk lookup support for content_cache

CREATE INDEX IF NOT EXISTS idx_content_cache_source
    ON content_cache(source);

CREATE INDEX IF NOT EXISTS idx_content_cache_expires
    ON content_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_content_cache_key_pattern
    ON content_cache(content_key varchar_pattern_ops);

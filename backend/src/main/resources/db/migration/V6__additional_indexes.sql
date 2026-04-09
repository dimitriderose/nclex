-- Indexes for soft-delete queries on bookmarks and highlights
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_deleted ON bookmarks(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_highlights_user_deleted ON highlights(user_id, deleted_at);

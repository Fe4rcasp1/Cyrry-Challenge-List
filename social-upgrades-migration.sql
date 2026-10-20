-- Run once in Cloudflare D1 Console for ccl-accounts.
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 message TEXT NOT NULL,
 link TEXT NOT NULL DEFAULT '',
 is_read INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,is_read,created_at);
ALTER TABLE player_profiles ADD COLUMN favorite_level TEXT NOT NULL DEFAULT '';
ALTER TABLE player_profiles ADD COLUMN featured_badge TEXT NOT NULL DEFAULT '';
ALTER TABLE player_profiles ADD COLUMN showcase_level TEXT NOT NULL DEFAULT '';
ALTER TABLE player_profiles ADD COLUMN background_url TEXT NOT NULL DEFAULT '';

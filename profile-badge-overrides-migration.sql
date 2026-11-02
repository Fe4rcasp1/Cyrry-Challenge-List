-- Run once in the production Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS profile_badge_overrides (
 leaderboard_username TEXT NOT NULL COLLATE NOCASE,
 badge_id TEXT NOT NULL,
 earned INTEGER NOT NULL CHECK(earned IN (0,1)),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (leaderboard_username,badge_id)
);

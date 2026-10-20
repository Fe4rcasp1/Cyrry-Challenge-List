-- Run once in Cloudflare D1 Console (ccl-accounts).
CREATE TABLE IF NOT EXISTS manual_enjoyment_ratings (
 list_type TEXT NOT NULL,
 level_path TEXT NOT NULL,
 leaderboard_username TEXT NOT NULL COLLATE NOCASE,
 enjoyment INTEGER NOT NULL CHECK(enjoyment BETWEEN 0 AND 10),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (list_type,level_path,leaderboard_username)
);
CREATE INDEX IF NOT EXISTS idx_manual_enjoyment_level ON manual_enjoyment_ratings(list_type,level_path);

-- CCL community upgrades. Run ONCE against the remote Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS player_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 bio TEXT NOT NULL DEFAULT '',
 avatar_url TEXT NOT NULL DEFAULT '',
 banner_url TEXT NOT NULL DEFAULT '',
 accent TEXT NOT NULL DEFAULT '#477bc1',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS record_submissions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 leaderboard_username TEXT NOT NULL,
 list_type TEXT NOT NULL CHECK(list_type IN ('normal','platformer')),
 level_path TEXT NOT NULL,
 percent INTEGER NOT NULL CHECK(percent BETWEEN 1 AND 100),
 video_url TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_record_submissions_status ON record_submissions(status,created_at);
CREATE INDEX IF NOT EXISTS idx_record_submissions_user ON record_submissions(user_id,created_at);
CREATE TABLE IF NOT EXISTS weekly_challenges (
 id TEXT PRIMARY KEY,
 week_start TEXT NOT NULL UNIQUE,
 list_type TEXT NOT NULL CHECK(list_type IN ('normal','platformer')),
 level_path TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS weekly_challenge_entries (
 id TEXT PRIMARY KEY,
 challenge_id TEXT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 video_url TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(challenge_id,user_id)
);
CREATE TABLE IF NOT EXISTS ranking_snapshots (
 id TEXT PRIMARY KEY,
 leaderboard_username TEXT NOT NULL COLLATE NOCASE,
 points REAL NOT NULL,
 rank INTEGER NOT NULL,
 captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(leaderboard_username,captured_at)
);
CREATE INDEX IF NOT EXISTS idx_ranking_history ON ranking_snapshots(leaderboard_username,captured_at);

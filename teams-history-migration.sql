-- Run once in Cloudflare D1 (ccl-accounts) before using Teams and Level History.
CREATE TABLE IF NOT EXISTS ccl_teams (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 tag TEXT NOT NULL COLLATE NOCASE UNIQUE,
 description TEXT NOT NULL DEFAULT '',
 owner_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ccl_team_members (
 team_id TEXT NOT NULL REFERENCES ccl_teams(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(team_id,user_id),
 UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_ccl_team_members_team ON ccl_team_members(team_id);
CREATE TABLE IF NOT EXISTS ccl_level_history (
 id TEXT PRIMARY KEY,
 list_type TEXT NOT NULL,
 level_path TEXT NOT NULL,
 action TEXT NOT NULL,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 summary TEXT NOT NULL,
 before_json TEXT,
 after_json TEXT NOT NULL,
 github_synced INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ccl_level_history_level ON ccl_level_history(list_type,level_path,created_at DESC);

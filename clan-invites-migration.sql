-- Run once in Cloudflare D1 SQL Console. Existing clans remain intact.
CREATE TABLE IF NOT EXISTS ccl_team_invites (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL REFERENCES ccl_teams(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id),
 used_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 used_at TEXT,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ccl_team_invites_team ON ccl_team_invites(team_id,created_at DESC);

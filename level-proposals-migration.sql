-- Run in Cloudflare D1 SQL console before enabling level/verification proposals.
CREATE TABLE IF NOT EXISTS ccl_level_proposals (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('level','verification')),
 list_type TEXT NOT NULL CHECK(list_type IN ('normal','platformer','impossible','impossible-platformer')),
 level_name TEXT NOT NULL,
 level_id TEXT,
 creator TEXT NOT NULL,
 proof_url TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id TEXT REFERENCES users(id),
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ccl_level_proposals_status ON ccl_level_proposals(status,created_at);
CREATE INDEX IF NOT EXISTS idx_ccl_level_proposals_user ON ccl_level_proposals(user_id,created_at DESC);

-- Run once in Cloudflare D1 Console. Existing accounts remain unchanged.
CREATE TABLE IF NOT EXISTS account_roles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','moderator')),
 granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS level_overrides (
 list_type TEXT NOT NULL CHECK(list_type IN ('normal','platformer')),
 level_path TEXT NOT NULL,
 level_json TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(list_type,level_path)
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- IMPORTANT: Promote your OWN existing account to owner with this separate query,
-- replacing YOUR_CCL_USERNAME with your actual registered account username:
-- INSERT INTO account_roles(user_id,role)
-- SELECT id,'owner' FROM users WHERE username='YOUR_CCL_USERNAME' COLLATE NOCASE;

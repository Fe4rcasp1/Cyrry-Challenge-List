-- Run once in Cloudflare D1 Console for ccl-accounts.
ALTER TABLE record_submissions ADD COLUMN discord_name TEXT NOT NULL DEFAULT '';
ALTER TABLE record_submissions ADD COLUMN enjoyment INTEGER;

ALTER TABLE sessions ADD COLUMN parentless INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET parentless = 1 WHERE team IS NOT NULL AND archived = 0
  AND parent IN (SELECT id FROM sessions WHERE archived = 1 OR state IN ('failed', 'interrupted'));
CREATE TABLE team_user_messages(
  request TEXT PRIMARY KEY,
  message TEXT NOT NULL UNIQUE REFERENCES team_messages(id),
  answered_at INTEGER
);

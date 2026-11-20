CREATE TABLE teams(
  id TEXT PRIMARY KEY, parent TEXT NOT NULL REFERENCES sessions(id), project TEXT NOT NULL,
  created_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE UNIQUE INDEX teams_active_parent ON teams(parent) WHERE closed_at IS NULL;
ALTER TABLE sessions ADD COLUMN team TEXT REFERENCES teams(id);
CREATE INDEX sessions_team ON sessions(team);
CREATE TABLE team_messages(
  id TEXT PRIMARY KEY, team TEXT NOT NULL REFERENCES teams(id),
  from_session TEXT NOT NULL REFERENCES sessions(id), to_session TEXT NOT NULL REFERENCES sessions(id),
  reply_to TEXT REFERENCES team_messages(id), body TEXT NOT NULL, urgent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX team_messages_inbox ON team_messages(to_session, read_at, created_at);

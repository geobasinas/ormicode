CREATE TABLE session_queue(
  id TEXT PRIMARY KEY, session TEXT NOT NULL, position INTEGER NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX session_queue_order ON session_queue(session, position, created_at);

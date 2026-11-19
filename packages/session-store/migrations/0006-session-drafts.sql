CREATE TABLE session_drafts (
  session TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

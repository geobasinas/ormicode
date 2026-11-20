ALTER TABLE projects RENAME TO projects_legacy;
CREATE TABLE projects (
  machine TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (machine, path)
) WITHOUT ROWID;

-- Slice 1 git workspaces: the exact commit a session was started at.
ALTER TABLE sessions ADD COLUMN base_commit TEXT;

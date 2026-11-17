-- Core store: sessions, journal events, tool calls, devices, cursors, outbox, leases.
CREATE TABLE sessions(
  id TEXT PRIMARY KEY, title TEXT, machine TEXT, project TEXT,
  vendor TEXT, transport TEXT, kind TEXT DEFAULT 'session', acp_version INTEGER,
  agent_command TEXT, agent_args TEXT,
  model TEXT, effort TEXT, mode TEXT, native_id TEXT,
  cwd TEXT, worktree TEXT, branch TEXT, base_branch TEXT,
  state TEXT, reason TEXT, options TEXT, parent TEXT, attempt INTEGER DEFAULT 1,
  handed_off INTEGER DEFAULT 0, worker_pid INTEGER,
  pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  last_seq INTEGER DEFAULT 0, log_dir TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE events(session TEXT, seq INTEGER, ts INTEGER, kind TEXT, origin TEXT,
  payload TEXT, crc INTEGER, PRIMARY KEY(session, seq));
CREATE TABLE tool_calls(session TEXT, call_id TEXT, seq INTEGER, name TEXT, kind TEXT,
  input TEXT, output TEXT, status TEXT, exit_code INTEGER,
  started_at INTEGER, ended_at INTEGER, bytes INTEGER, PRIMARY KEY(session, call_id));
CREATE TABLE projects(id TEXT PRIMARY KEY, machine TEXT, path TEXT, remote TEXT, default_branch TEXT);
CREATE TABLE machines(id TEXT PRIMARY KEY, name TEXT, kind TEXT, last_seen INTEGER, meta TEXT);
CREATE TABLE devices(id TEXT PRIMARY KEY, name TEXT, token_hash TEXT, trusted_at INTEGER, revoked_at INTEGER);
CREATE TABLE device_cursors(device TEXT, session TEXT, seq INTEGER, PRIMARY KEY(device, session));
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT, scope TEXT);
CREATE TABLE outbox(session TEXT, seq INTEGER, frame TEXT, created_at INTEGER, PRIMARY KEY(session, seq));
CREATE TABLE leases(path TEXT, session TEXT, machine TEXT, kind TEXT,
  acquired_at INTEGER, renewed_at INTEGER, PRIMARY KEY(path, session));
CREATE INDEX sessions_machine_updated ON sessions(machine, updated_at);
CREATE INDEX sessions_project_state ON sessions(project, state);
CREATE INDEX tool_calls_started ON tool_calls(session, started_at);
CREATE INDEX leases_session ON leases(session);

import type { Store } from './db.ts';

export type SessionState =
  | 'idle' | 'starting' | 'running' | 'awaiting_approval' | 'awaiting_input' | 'retrying'
  | 'paused_rate_limited' | 'interrupted' | 'failed' | 'done' | 'archived';

export interface SessionRow {
  id: string; title: string | null; machine: string; project: string;
  vendor: string; transport: string; kind: string; acp_version: number | null;
  agent_command: string | null; agent_args: string | null;
  model: string | null; effort: string | null; mode: string | null; native_id: string | null;
  cwd: string; worktree: string | null; branch: string | null; base_branch: string | null;
  base_commit: string | null; team: string | null; parentless: number;
  state: SessionState; reason: string | null; options: string | null; parent: string | null;
  attempt: number; handed_off: number; worker_pid: number | null;
  pinned: number; archived: number; last_seq: number; log_dir: string | null;
  created_at: number; updated_at: number;
}

export interface NewSession {
  id: string; machine: string; project: string; vendor: string; transport: string;
  kind?: string; model?: string; effort?: string; mode?: string;
  agentCommand?: string; agentArgs?: string[];
  cwd: string; worktree?: string; branch?: string; baseBranch?: string;
  baseCommit?: string; title?: string; parent?: string; now?: number;
}

export function createSession(db: Store, s: NewSession): void {
  const now = s.now ?? Date.now();
  db.prepare(`INSERT INTO sessions(id, title, machine, project, vendor, transport, kind,
    agent_command, agent_args, model, effort, mode, cwd, worktree, branch, base_branch,
    base_commit, parent, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`)
    .run(s.id, s.title ?? null, s.machine, s.project, s.vendor, s.transport, s.kind ?? 'session',
      s.agentCommand ?? null, s.agentArgs ? JSON.stringify(s.agentArgs) : null,
      s.model ?? null, s.effort ?? null, s.mode ?? null,
      s.cwd, s.worktree ?? null, s.branch ?? null, s.baseBranch ?? null, s.baseCommit ?? null,
      s.parent ?? null, now, now);
}

export function getSession(db: Store, id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function listSessions(db: Store, archived = false): SessionRow[] {
  return db.prepare(`SELECT * FROM sessions WHERE archived = ? AND kind = 'session' ORDER BY updated_at DESC`)
    .all(archived ? 1 : 0) as SessionRow[];
}

export function sessionsInStates(db: Store, states: readonly SessionState[]): SessionRow[] {
  const marks = states.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM sessions WHERE state IN (${marks})`).all(...states) as SessionRow[];
}

export function setState(db: Store, id: string, state: SessionState, reason?: string, ts?: number): void {
  db.prepare('UPDATE sessions SET state = ?, reason = ?, updated_at = ? WHERE id = ?')
    .run(state, reason ?? null, ts ?? Date.now(), id);
}

export function setWorkerPid(db: Store, id: string, pid: number | null): void {
  db.prepare('UPDATE sessions SET worker_pid = ? WHERE id = ?').run(pid, id);
}

export function setNativeId(db: Store, id: string, nativeId: string | null): void {
  db.prepare('UPDATE sessions SET native_id = ? WHERE id = ?').run(nativeId, id);
}

export function setTitle(db: Store, id: string, title: string): void {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
}

export function setBranch(db: Store, id: string, branch: string | null): void {
  db.prepare('UPDATE sessions SET branch = ?, updated_at = ? WHERE id = ?').run(branch, Date.now(), id);
}

export function archiveSession(db: Store, id: string): void {
  db.prepare('UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
}

/** Brings an archived session back to the default list; false when it was not archived. */
export function unarchiveSession(db: Store, id: string): boolean {
  return db.prepare('UPDATE sessions SET archived = 0, updated_at = ? WHERE id = ? AND archived = 1').run(Date.now(), id).changes > 0;
}

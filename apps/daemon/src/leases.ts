import { getSession, type Store } from '@ormicode/session-store';

// Workspace leases: one live session owns a checkout path. Dead holders (archived,
// failed, done) have their lease reclaimed; live holders cause a conflict.
export function acquireWorkspace(db: Store, path: string, session: string, machine: string): { conflict?: string } {
  const row = db.prepare('SELECT session FROM leases WHERE path = ? AND session != ?').get(path, session) as { session: string } | undefined;
  if (row) {
    const holder = getSession(db, row.session);
    if (holder && !['archived', 'failed', 'done'].includes(holder.state)) return { conflict: row.session };
    db.prepare('DELETE FROM leases WHERE path = ?').run(path);
  }
  db.prepare('INSERT INTO leases(path, session, machine, kind, acquired_at, renewed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(path, session, machine, 'workspace', Date.now(), Date.now());
  return {};
}

export function releaseForSession(db: Store, session: string): void {
  db.prepare('DELETE FROM leases WHERE session = ?').run(session);
}

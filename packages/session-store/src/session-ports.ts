import type { Store } from './db.ts';

export function getSessionPorts(db: Store, session: string): number | undefined {
  const row = db.prepare('SELECT base FROM session_ports WHERE session = ?').get(session) as { base: number } | undefined;
  return row?.base;
}

export function assignSessionPorts(db: Store, session: string, base: number): boolean {
  const result = db.prepare('INSERT OR IGNORE INTO session_ports(session, base) VALUES (?, ?)').run(session, base);
  return result.changes === 1 || getSessionPorts(db, session) === base;
}

export function releaseSessionPorts(db: Store, session: string): boolean {
  return db.prepare('DELETE FROM session_ports WHERE session = ?').run(session).changes === 1;
}

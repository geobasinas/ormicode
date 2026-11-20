import type { Store } from '@ormicode/session-store';

export function shouldRecordResume(db: Store, session: string): boolean {
  const last = db.prepare('SELECT kind FROM events WHERE session = ? ORDER BY seq DESC LIMIT 1').get(session) as { kind: string } | undefined;
  return last?.kind !== 'resumed';
}

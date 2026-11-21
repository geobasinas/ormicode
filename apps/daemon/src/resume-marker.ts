import type { Store } from '@ormicode/session-store';

/** Bookkeeping kinds the transcript hides; they are not activity between resumes. */
const hiddenKinds = ['evicted', 'usage', 'state', 'agent_version', 'turn_start', 'turn_end', 'terminal_open', 'terminal_close'];

export function shouldRecordResume(db: Store, session: string): boolean {
  const last = db.prepare(`SELECT kind FROM events WHERE session = ? AND kind NOT IN (${hiddenKinds.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT 1`)
    .get(session, ...hiddenKinds) as { kind: string } | undefined;
  return last?.kind !== 'resumed';
}

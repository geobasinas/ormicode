import type { Store } from '@ormicode/session-store';
import { crc32c } from './crc.ts';

export interface TailCheck { dropped: number; mismatched: number[] }

/**
 * On open: verify each row's CRC32C and drop a torn tail. A crash between the
 * insert and the commit leaves a last row whose crc/payload don't line up (or a
 * row beyond sessions.last_seq); those are removed, never silently kept.
 */
export function checkTail(db: Store, session: string): TailCheck {
  const rows = db.prepare('SELECT seq, payload, crc FROM events WHERE session = ? ORDER BY seq')
    .all(session) as { seq: number; payload: string; crc: number }[];
  const lastSeq = (db.prepare('SELECT last_seq FROM sessions WHERE id = ?').get(session) as { last_seq: number } | undefined)?.last_seq ?? 0;
  const mismatched: number[] = [];
  let firstBad = Infinity;
  for (const row of rows) {
    if (row.seq > lastSeq || crc32c(row.payload) !== row.crc) { mismatched.push(row.seq); if (row.seq < firstBad) firstBad = row.seq; }
  }
  // A gap or a bad row invalidates that row only if it is the tail; mid-log
  // corruption is reported but left for `ormi doctor --repair`.
  let dropped = 0;
  if (Number.isFinite(firstBad) && firstBad === rows.at(-1)?.seq) {
    db.prepare('DELETE FROM events WHERE session = ? AND seq >= ?').run(session, firstBad);
    db.prepare('DELETE FROM outbox WHERE session = ? AND seq >= ?').run(session, firstBad);
    dropped = rows.filter(r => r.seq >= firstBad).length;
  }
  return { dropped, mismatched };
}

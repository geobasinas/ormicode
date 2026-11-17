import type { Store } from '@ormicode/session-store';
import { crc32c } from './crc.ts';

export interface JournalEvent {
  kind: string;
  origin?: string;
  payload: Record<string, unknown>;
  ts?: number;
}

export interface JournalRow {
  session: string; seq: number; ts: number; kind: string;
  origin: string | null; payload: string; crc: number;
}

const insertEvent = (db: Store) => db.prepare(
  'INSERT INTO events(session, seq, ts, kind, origin, payload, crc) VALUES (?, ?, ?, ?, ?, ?, ?)');
const insertOutbox = (db: Store) => db.prepare(
  'INSERT INTO outbox(session, seq, frame, created_at) VALUES (?, ?, ?, ?)');
const bumpSeq = (db: Store) => db.prepare(
  'UPDATE sessions SET last_seq = ?, updated_at = ? WHERE id = ?');

/**
 * Assign seq -> write the journal row and the outbox frame in ONE transaction ->
 * update last_seq/updated_at in the same commit. The journal is always ahead of
 * the wire, so a crash cannot produce an event a client saw but the store lost.
 * Returns the assigned seq; the caller sends the frame after commit.
 */
export function append(db: Store, session: string, event: JournalEvent): { seq: number; ts: number; frame: string } {
  const ts = event.ts ?? Date.now();
  const row = db.transaction(() => {
    const seq = ((db.prepare('SELECT last_seq FROM sessions WHERE id = ?').get(session) as { last_seq: number } | undefined)?.last_seq ?? 0) + 1;
    const payload = JSON.stringify(event.payload);
    insertEvent(db).run(session, seq, ts, event.kind, event.origin ?? null, payload, crc32c(payload));
    const frame = JSON.stringify({ v: 1, type: 'evt', session, seq, ts, body: { kind: event.kind, ...event.payload } });
    insertOutbox(db).run(session, seq, frame, ts);
    bumpSeq(db).run(seq, ts, session);
    return { seq, frame };
  })();
  return { seq: row.seq, ts, frame: row.frame };
}

/** Durable rows from `after` (exclusive), in seq order, for resync. */
export function replay(db: Store, session: string, after = 0): JournalRow[] {
  return db.prepare('SELECT * FROM events WHERE session = ? AND seq > ? ORDER BY seq')
    .all(session, after) as JournalRow[];
}

/** Outbox frames newer than a device cursor. */
export function outboxSince(db: Store, session: string, after: number): { seq: number; frame: string }[] {
  return db.prepare('SELECT seq, frame FROM outbox WHERE session = ? AND seq > ? ORDER BY seq')
    .all(session, after) as { seq: number; frame: string }[];
}

export function getCursor(db: Store, device: string, session: string): number {
  const row = db.prepare('SELECT seq FROM device_cursors WHERE device = ? AND session = ?').get(device, session) as { seq: number } | undefined;
  return row?.seq ?? 0;
}

export function setCursor(db: Store, device: string, session: string, seq: number): void {
  db.prepare(`INSERT INTO device_cursors(device, session, seq) VALUES (?, ?, ?)
    ON CONFLICT(device, session) DO UPDATE SET seq = excluded.seq`).run(device, session, seq);
}

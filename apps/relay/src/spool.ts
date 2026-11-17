/// <reference types="@cloudflare/workers-types" />
/**
 * R2 event-chunk spooling. Live fan-out and the bounded DO outbox cover
 * recent history; anything older is spooled to append-only ndjson chunks
 * `s/<session>/<first>-<last>.ndjson` (flush at 100 frames or 60 s) so a
 * device that was offline longer than the outbox still catches up without
 * waking the hub. Chunk bounds are tracked in DO SQLite.
 */

export interface SpoolEnv { EVENTS?: R2Bucket }

const FLUSH_FRAMES = 100;
const FLUSH_MS = 60_000;
/** Max frames replayed from chunks during one subscribe; beyond → resync. */
export const REPLAY_LIMIT = 5000;

export class Spooler {
  private pending = new Map<string, { first: number; last: number; frames: string[] }>();
  private bucket: R2Bucket | undefined;
  private sql: SqlStorage;
  private setAlarm: (ms: number) => void;

  constructor(sql: SqlStorage, env: SpoolEnv, setAlarm: (ms: number) => void) {
    this.sql = sql; this.bucket = env.EVENTS; this.setAlarm = setAlarm;
  }

  /** Buffer one serialized frame; flushes at FLUSH_FRAMES or arms the 60 s alarm. */
  add(session: string, seq: number, frame: string): void {
    let p = this.pending.get(session);
    if (!p) { p = { first: seq, last: seq, frames: [] }; this.pending.set(session, p); this.arm(); }
    p.frames.push(frame); p.last = seq;
    if (p.frames.length >= FLUSH_FRAMES) void this.flush();
  }

  private arm(): void { this.setAlarm(Date.now() + FLUSH_MS); }

  async flush(): Promise<void> {
    if (!this.bucket) { this.pending.clear(); return; }
    for (const [session, p] of this.pending) {
      this.pending.delete(session);
      if (!p.frames.length) continue;
      const key = `s/${session}/${p.first}-${p.last}.ndjson`;
      try {
        await this.bucket.put(key, p.frames.join('\n') + '\n');
        this.sql.exec('INSERT OR REPLACE INTO chunks(session, first, last, key) VALUES (?, ?, ?, ?)', session, p.first, p.last, key);
      } catch { /* R2 down: frames stay only in the outbox; hub remains source of truth */ }
    }
  }

  /** Frames with seq > after that live only in chunks (outbox couldn't cover). */
  async missing(session: string, after: number): Promise<{ frames: string[]; tooFar: boolean }> {
    const frames: string[] = [];
    if (!this.bucket) return { frames, tooFar: true };
    const rows = this.sql.exec('SELECT first, last, key FROM chunks WHERE session = ? AND last > ? ORDER BY first', session, after).toArray();
    for (const row of rows) {
      const obj = await this.bucket.get(String(row.key));
      if (!obj) continue;
      for (const line of (await obj.text()).split('\n')) {
        if (!line) continue;
        let seq = 0;
        try { seq = Number((JSON.parse(line) as { seq?: number }).seq ?? 0); } catch { continue; }
        if (seq > after) frames.push(line);
        if (frames.length > REPLAY_LIMIT) return { frames: [], tooFar: true };
      }
    }
    return { frames, tooFar: false };
  }

  /** Any unflushed frames pending? (for alarm scheduling decisions) */
  get dirty(): boolean { return this.pending.size > 0; }
}

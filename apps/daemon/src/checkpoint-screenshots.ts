import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSession, type Store } from '@ormicode/session-store';
import type { Checkpoints } from '@ormicode/checkpoints';

type Snapshot = (session: string, seq: number, tool: string) => Promise<string | undefined>;
type Capture = (session: string, checkpoint: string) => Promise<void>;

export function checkpointSnapshot(checkpoints: Checkpoints, db: Store, record: (session: string, kind: string, body: Record<string, unknown>) => void,
  enabled: () => boolean, dataRoot: string, onError: (session: string, error: unknown) => void): Snapshot {
  return async (session, seq, tool) => {
    const cwd = getSession(db, session)?.cwd;
    if (!enabled() || !cwd || !existsSync(cwd) || cwd.startsWith(join(dataRoot, 'scratch'))) return undefined;
    try {
      const result = await checkpoints.snapshot(session, cwd, seq, tool);
      if (!result.checkpoint) return undefined;
      record(session, 'checkpoint', { id: result.checkpoint.id, seq, tool, ...(result.overCap ? { overCap: result.overCap } : {}) });
      return result.checkpoint.id;
    } catch (error) { onError(session, error); return undefined; }
  };
}

export class CheckpointScreenshotScheduler {
  private readonly take: Snapshot;
  private readonly capture: Capture;
  private readonly turns = new Map<string, { pending: Promise<void>[]; checkpoints: { seq: number; id: string }[] }>();

  constructor(take: Snapshot, capture: Capture) { this.take = take; this.capture = capture; }
  start(session: string): void { this.turns.set(session, { pending: [], checkpoints: [] }); }
  checkpoint(session: string, seq: number, tool: string): void {
    const turn = this.turns.get(session);
    if (turn) turn.pending.push(this.take(session, seq, tool).then(id => { if (id) turn.checkpoints.push({ seq, id }); }));
    else void this.take(session, seq, tool);
  }
  end(session: string): void {
    const turn = this.turns.get(session);
    if (!turn) return;
    void Promise.allSettled(turn.pending).then(() => {
      if (this.turns.get(session) === turn) this.turns.delete(session);
      const checkpoint = turn.checkpoints.sort((a, b) => a.seq - b.seq).at(-1)?.id;
      if (checkpoint) void this.capture(session, checkpoint).catch(() => undefined);
    });
  }
}

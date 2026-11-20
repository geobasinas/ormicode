import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSession, type Store } from '@ormicode/session-store';
import type { Checkpoints } from '@ormicode/checkpoints';
import type { UiCheckResult } from './ui-check.ts';

type Snapshot = (session: string, seq: number, tool: string) => Promise<{ id: string; files: string[] } | undefined>;
export interface ScheduledCapture { shouldCheck: boolean; result: Promise<UiCheckResult | undefined> }
type Capture = (session: string, checkpoint: string, files: string[], startedAt: number, consoleAfter: number, shouldCheck: boolean) => Promise<UiCheckResult | undefined>;
type ShouldCheck = (session: string, files: string[]) => Promise<boolean>;
interface Turn {
  pending: Promise<void>[];
  checkpoints: { seq: number; id: string; files: string[] }[];
  startedAt: number;
  consoleAfter: number;
}

export function checkpointSnapshot(checkpoints: Checkpoints, db: Store, record: (session: string, kind: string, body: Record<string, unknown>) => void,
  enabled: () => boolean, dataRoot: string, onError: (session: string, error: unknown) => void): Snapshot {
  return async (session, seq, tool) => {
    const cwd = getSession(db, session)?.cwd;
    if (!enabled() || !cwd || !existsSync(cwd) || cwd.startsWith(join(dataRoot, 'scratch'))) return undefined;
    try {
      const result = await checkpoints.snapshot(session, cwd, seq, tool);
      if (!result.checkpoint) return undefined;
      record(session, 'checkpoint', { id: result.checkpoint.id, seq, tool, ...(result.overCap ? { overCap: result.overCap } : {}) });
      const files = await checkpoints.changedFiles(session, result.checkpoint.id);
      return { id: result.checkpoint.id, files };
    } catch (error) { onError(session, error); return undefined; }
  };
}

export class CheckpointScreenshotScheduler {
  private readonly take: Snapshot;
  private readonly capture: Capture;
  private readonly shouldCheck: ShouldCheck;
  private readonly turns = new Map<string, Turn>();

  constructor(take: Snapshot, capture: Capture, shouldCheck: ShouldCheck) {
    this.take = take; this.capture = capture; this.shouldCheck = shouldCheck;
  }
  start(session: string, consoleAfter = 0): void {
    this.turns.set(session, { pending: [], checkpoints: [], startedAt: Date.now(), consoleAfter });
  }
  checkpoint(session: string, seq: number, tool: string): void {
    const turn = this.turns.get(session);
    if (turn) turn.pending.push(this.take(session, seq, tool).then(result => {
      if (result) turn.checkpoints.push({ seq, ...result });
    }));
    else void this.take(session, seq, tool);
  }
  async end(session: string): Promise<ScheduledCapture | undefined> {
    const turn = this.turns.get(session);
    if (!turn) return undefined;
    await Promise.allSettled(turn.pending);
    if (this.turns.get(session) === turn) this.turns.delete(session);
    const latest = turn.checkpoints.sort((a, b) => a.seq - b.seq).at(-1);
    if (!latest) return undefined;
    const files = [...new Set(turn.checkpoints.flatMap(checkpoint => checkpoint.files))];
    let shouldCheck = false;
    try { shouldCheck = await this.shouldCheck(session, files); } catch { /* Checkpoint capture remains best-effort. */ }
    return {
      shouldCheck,
      result: this.capture(session, latest.id, files, turn.startedAt, turn.consoleAfter, shouldCheck).catch(() => undefined),
    };
  }
}

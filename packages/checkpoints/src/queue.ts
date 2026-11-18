// Per-session background queue over ShadowRepo, plus the storage caps:
// oldest pruned first, the restored-to checkpoint is kept.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ShadowRepo, type Checkpoint } from './shadow.ts';

export interface CheckpointLimits { max: number; maxBytes: number }
export const DEFAULT_LIMITS: CheckpointLimits = { max: 200, maxBytes: 1024 ** 3 };
export interface SnapshotResult { checkpoint: Checkpoint | null; overCap?: number }

function size(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? size(p) : statSync(p).size;
  }
  return total;
}

export class Checkpoints {
  private chains = new Map<string, Promise<unknown>>();
  readonly root: string; readonly limits: CheckpointLimits;
  constructor(root: string, limits: CheckpointLimits = DEFAULT_LIMITS) { this.root = root; this.limits = limits; }

  repo(session: string): ShadowRepo { return new ShadowRepo(join(this.root, session), session); }

  /** Serialise work per session so snapshots, restores and prunes never interleave. */
  run<T>(session: string, job: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(session) ?? Promise.resolve()).then(job, job);
    const tail = next.catch(() => undefined);
    this.chains.set(session, tail);
    void tail.then(() => { if (this.chains.get(session) === tail) this.chains.delete(session); });
    return next;
  }

  snapshot(session: string, worktree: string, seq: number, tool: string): Promise<SnapshotResult> {
    return this.run(session, async () => {
      const repo = this.repo(session);
      const checkpoint = await repo.snapshot(worktree, seq, tool);
      if (!checkpoint) return { checkpoint };
      const overCap = await this.prune(repo);
      return overCap ? { checkpoint, overCap } : { checkpoint };
    });
  }

  /** Returns the remaining size in bytes when one checkpoint alone is over maxBytes. */
  private async prune(repo: ShadowRepo): Promise<number | undefined> {
    const keep = repo.pinned();
    const oldestFirst = (await repo.list()).reverse();
    const droppable = () => oldestFirst.filter(c => c.id !== keep);
    const excess = oldestFirst.length - this.limits.max;
    if (excess > 0) { await repo.drop(droppable().slice(0, excess)); oldestFirst.splice(0, oldestFirst.length, ...(await repo.list()).reverse()); }
    let bytes = size(repo.dir);
    if (bytes <= this.limits.maxBytes) return undefined;
    await repo.gc(); bytes = size(repo.dir);
    while (bytes > this.limits.maxBytes && droppable().length > 1) {
      const victim = droppable()[0]!;
      await repo.drop([victim]); oldestFirst.splice(oldestFirst.indexOf(victim), 1);
      await repo.gc(); bytes = size(repo.dir);
    }
    return bytes > this.limits.maxBytes ? bytes : undefined;
  }

  remove(session: string): Promise<void> { return this.run(session, async () => this.repo(session).remove()); }
}

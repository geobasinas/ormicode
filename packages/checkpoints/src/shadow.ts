// One shadow git repo per session: its own GIT_DIR and index, the session's
// worktree as GIT_WORK_TREE. The user's .git, branch and index are never read
// or moved; .gitignore is honoured; untracked files are captured.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const run = promisify(execFile);
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const PATCH_CAP = 1024 * 1024;

export interface Checkpoint { id: string; seq: number; tool: string; ts: number }
export interface CheckpointDiff { patch: string; truncated: boolean }

export class ShadowRepo {
  readonly dir: string; readonly session: string;
  constructor(dir: string, session: string) { this.dir = dir; this.session = session; }

  private async git(worktree: string, args: string[], index = join(this.dir, 'index'), env: Record<string, string> = {}): Promise<string> {
    const { stdout } = await run('git', [
      '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.quotepath=false',
      '-c', 'user.name=ormicode', '-c', 'user.email=checkpoints@ormicode.local', ...args,
    ], {
      env: { ...process.env, GIT_DIR: this.dir, GIT_WORK_TREE: worktree, GIT_INDEX_FILE: index, GIT_CONFIG_NOSYSTEM: '1', ...env },
      encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true,
    });
    return stdout;
  }

  exists(): boolean { return existsSync(join(this.dir, 'HEAD')); }

  private async init(): Promise<void> {
    if (this.exists()) return;
    mkdirSync(this.dir, { recursive: true });
    await run('git', ['init', '--bare', '--quiet', this.dir], { windowsHide: true });
    // Session worktrees live under <project>/.ormi/; never snapshot them into the parent.
    mkdirSync(join(this.dir, 'info'), { recursive: true });
    writeFileSync(join(this.dir, 'info', 'exclude'), '.ormi/\n');
  }

  /** Commit the worktree if it changed since the last checkpoint; null = no change. */
  async snapshot(worktree: string, seq: number, tool: string, ts = Date.now(), force = false): Promise<Checkpoint | null> {
    await this.init();
    await this.git(worktree, ['add', '-A', '--', '.']);
    const tree = (await this.git(worktree, ['write-tree'])).trim();
    const last = await this.ref('refs/ormi/head');
    if (!force && last && (await this.git(worktree, ['rev-parse', `${last}^{tree}`])).trim() === tree) return null;
    const secs = Math.floor(ts / 1000);
    // Parentless commits: pruning a ref frees its objects (no chain keeps them alive).
    const id = (await this.git(worktree, ['commit-tree', tree, '-m', `checkpoint ${this.session} seq=${seq} tool=${tool}`],
      undefined, { GIT_COMMITTER_DATE: `${secs} +0000`, GIT_AUTHOR_DATE: `${secs} +0000` })).trim();
    await this.git(worktree, ['update-ref', `refs/ormi/cp/${String(seq).padStart(12, '0')}`, id]);
    await this.git(worktree, ['update-ref', 'refs/ormi/head', id]);
    return { id, seq, tool, ts: secs * 1000 };
  }

  private async ref(name: string): Promise<string | undefined> {
    try { return (await this.git(this.dir, ['rev-parse', '--verify', '--quiet', name])).trim() || undefined; }
    catch { return undefined; }
  }

  /** Newest first. */
  async list(): Promise<Checkpoint[]> {
    if (!this.exists()) return [];
    const out = await this.git(this.dir, ['for-each-ref', '--sort=-refname', '--format=%(objectname) %(committerdate:unix) %(contents:subject)', 'refs/ormi/cp/']);
    return out.split('\n').filter(Boolean).flatMap(line => {
      const m = /^(\S+) (\d+) checkpoint \S+ seq=(\d+) tool=(.*)$/.exec(line);
      return m ? [{ id: m[1]!, ts: Number(m[2]) * 1000, seq: Number(m[3]), tool: m[4]! }] : [];
    });
  }

  async find(id: string): Promise<Checkpoint | undefined> {
    return (await this.list()).find(c => c.id === id || (id.length >= 7 && c.id.startsWith(id)));
  }

  /** Patch from `from` to `to`; without `to`, what `from` changed since the checkpoint before it. */
  async diff(from: Checkpoint, to?: Checkpoint): Promise<CheckpointDiff> {
    let a = from.id; let b = to?.id;
    if (!b) {
      const all = await this.list();
      const prev = all[all.findIndex(c => c.id === from.id) + 1];
      b = from.id; a = prev?.id ?? EMPTY_TREE;
    }
    const patch = await this.git(this.dir, ['diff', '--no-color', '--no-ext-diff', '--no-renames', a, b]);
    return patch.length > PATCH_CAP ? { patch: patch.slice(0, PATCH_CAP), truncated: true } : { patch, truncated: false };
  }

  async changedFiles(from: Checkpoint, to?: Checkpoint): Promise<string[]> {
    let a = from.id; let b = to?.id;
    if (!b) {
      const all = await this.list();
      const prev = all[all.findIndex(c => c.id === from.id) + 1];
      b = from.id; a = prev?.id ?? EMPTY_TREE;
    }
    const output = await this.git(this.dir, ['diff', '--name-only', '--no-renames', '-z', a, b]);
    return output.split('\0').filter(Boolean);
  }

  /** Make `worktree` match the checkpoint: changed files rewritten, files it lacks deleted, ignored files untouched. */
  async writeTo(worktree: string, cp: Checkpoint): Promise<void> {
    const index = join(this.dir, `restore-${randomBytes(4).toString('hex')}.index`);
    try {
      await this.git(worktree, ['add', '-A', '--', '.'], index);
      await this.git(worktree, ['read-tree', '--reset', '-u', cp.id], index);
    } finally { rmSync(index, { force: true }); }
  }

  async restore(worktree: string, cp: Checkpoint): Promise<void> {
    await this.writeTo(worktree, cp);
    writeFileSync(join(this.dir, 'ormi-restored'), cp.id);
  }

  /** The checkpoint this session was last restored to; never pruned. */
  pinned(): string | undefined {
    try { return readFileSync(join(this.dir, 'ormi-restored'), 'utf8').trim() || undefined; } catch { return undefined; }
  }

  async drop(cps: Checkpoint[]): Promise<void> {
    for (const cp of cps) await this.git(this.dir, ['update-ref', '-d', `refs/ormi/cp/${String(cp.seq).padStart(12, '0')}`]);
  }

  async gc(): Promise<void> {
    await this.git(this.dir, ['reflog', 'expire', '--expire=now', '--all']);
    await this.git(this.dir, ['gc', '--prune=now', '--quiet']);
  }

  remove(): void { rmSync(this.dir, { recursive: true, force: true }); }
}

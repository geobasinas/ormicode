// Session diff against its recorded base commit: tracked changes in the
// worktree plus untracked (non-ignored) files. Never touches the index.
import { execFileSync } from 'node:child_process';
import { parsePatch, type FilePatch } from '@ormicode/diff';

export interface DiffStat { added: number; removed: number; files: number }
const opts = (cwd: string) => ({ cwd, encoding: 'utf8' as const, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] });

// `git diff --no-index` exits 1 when files differ; its stdout is still the patch.
function gitOut(cwd: string, args: string[]): string {
  try { return execFileSync('git', ['-c', 'core.quotepath=false', ...args], opts(cwd)); }
  catch (e) { const out = (e as { stdout?: string }).stdout; if (typeof out === 'string' && (e as { status?: number }).status === 1) return out; throw e; }
}

const untracked = (cwd: string) => gitOut(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);

export function diffPatch(cwd: string, base = 'HEAD'): { patch: string; files: FilePatch[] } {
  let patch = gitOut(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', base]);
  for (const f of untracked(cwd)) patch += gitOut(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', f]);
  return { patch, files: parsePatch(patch) };
}

export function diffStat(cwd: string, base = 'HEAD'): DiffStat {
  const files = diffPatch(cwd, base).files;
  return { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}

/** session.list calls this per row; a short TTL keeps the list cheap. */
export class DiffStatCache {
  private entries = new Map<string, { at: number; stat: DiffStat | null }>();
  readonly ttlMs: number;
  constructor(ttlMs = 10_000) { this.ttlMs = ttlMs; }
  get(cwd: string, base: string | undefined, now = Date.now()): DiffStat | null {
    const key = `${cwd}\0${base ?? ''}`;
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.stat;
    let stat: DiffStat | null = null;
    try { stat = diffStat(cwd, base); } catch { /* not a repo, or base gone */ }
    this.entries.set(key, { at: now, stat });
    return stat;
  }
}

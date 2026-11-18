import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isGitRepo, log } from '@ormicode/git-core';
import { FileError } from './errors.ts';
import { resolvePath } from './paths.ts';

type CommitInfo = { author: string; ts: number; summary: string; session?: string };

function git(root: string, args: string[], maxBuffer = 64 * 1024 * 1024): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer, windowsHide: true,
  });
}

export function fileHistory(root: string, value: string, limit = 50) {
  const safe = resolvePath(root, value, true);
  if (!safe.path) throw new FileError('file.not_found', 'A file path is required');
  if (existsSync(safe.absolute) && !statSync(safe.absolute).isFile())
    throw new FileError('file.not_found', `Not a file: ${safe.path}`);
  if (!isGitRepo(safe.root)) {
    if (!existsSync(safe.absolute)) throw new FileError('file.not_found', `File not found: ${safe.path}`);
    throw new FileError('file.not_git', 'File history requires a Git repository');
  }
  const history = log(safe.root, { path: safe.path, limit });
  if (!history.total && !existsSync(safe.absolute)) throw new FileError('file.not_found', `File not found: ${safe.path}`);
  return history;
}

export function fileBlame(root: string, value: string) {
  const safe = resolvePath(root, value);
  if (!statSync(safe.absolute).isFile()) throw new FileError('file.not_found', `Not a file: ${safe.path}`);
  if (!isGitRepo(safe.root)) throw new FileError('file.not_git', 'Blame requires a Git repository');
  let output: string;
  try { output = git(safe.root, ['blame', '--porcelain', '--', safe.path]); }
  catch (error) { throw new FileError('file.failed', error instanceof Error ? error.message : String(error)); }

  const hunks: Array<{ start: number; count: number; sha: string }> = [];
  const known = new Map<string, CommitInfo>();
  const rows = output.split('\n');
  const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/;
  let i = 0;
  while (i < rows.length) {
    const match = header.exec(rows[i] ?? '');
    if (!match) { i++; continue; }
    const sha = match[1]!;
    const start = Number(match[3]);
    const count = Number(match[4] ?? 1);
    const info = known.get(sha) ?? { author: '', ts: 0, summary: '' };
    i++;
    while (i < rows.length && !rows[i]!.startsWith('\t') && !header.test(rows[i]!)) {
      const row = rows[i]!;
      if (row.startsWith('author ')) info.author = row.slice(7);
      else if (row.startsWith('author-time ')) info.ts = Number(row.slice(12)) * 1000;
      else if (row.startsWith('summary ')) info.summary = row.slice(8);
      i++;
    }
    if (sha === '0'.repeat(40) || sha === '0'.repeat(64)) info.author = 'Not committed yet';
    known.set(sha, info);
    hunks.push({ start, count, sha });
    for (let line = 0; line < count && rows[i]?.startsWith('\t'); line++) i++;
  }

  const committed = [...known.keys()].filter(sha => !/^0+$/.test(sha));
  const sessions = new Map<string, string>();
  if (committed.length) {
    try {
      const body = git(safe.root, ['log', '--no-walk', '--format=%x1e%H%x00%B%x00', ...committed]);
      for (const record of body.split('\x1e').filter(Boolean)) {
        const [sha = '', ...parts] = record.split('\0');
        const session = /^Ormi-Session:\s*(\S+)\s*$/mi.exec(parts.join('\0'))?.[1];
        if (session) sessions.set(sha.trim(), session);
      }
    } catch (error) { throw new FileError('file.failed', error instanceof Error ? error.message : String(error)); }
  }

  const commits: Record<string, CommitInfo> = {};
  for (const [sha, info] of known) {
    const session = sessions.get(sha);
    commits[sha] = { ...info, ...(session ? { session } : {}) };
  }
  return { hunks, commits };
}

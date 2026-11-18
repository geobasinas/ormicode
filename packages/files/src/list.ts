import { readdirSync, lstatSync, statfsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isGitRepo } from '@ormicode/git-core';
import { execFileSync } from 'node:child_process';
import { FileError } from './errors.ts';
import { resolvePath } from './paths.ts';

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflicted';
type DirectStatus = { status: GitFileStatus; oldPath?: string };

function gitStatuses(root: string): Map<string, DirectStatus> {
  const statuses = new Map<string, DirectStatus>();
  let output: string;
  try {
    output = execFileSync('git', ['-C', root, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching'], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
    });
  } catch (error) {
    throw new FileError('file.failed', error instanceof Error ? error.message : String(error));
  }

  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const row = records[i] ?? '';
    if (!row || row.startsWith('#')) continue;
    let path = '';
    let status: GitFileStatus;
    if (row.startsWith('? ')) {
      path = row.slice(2);
      status = 'untracked';
    } else if (row.startsWith('! ')) {
      path = row.slice(2);
      status = 'ignored';
    } else {
      const type = row[0];
      const fields = row.split(' ');
      const fieldCount = type === '2' ? 9 : type === 'u' ? 10 : 8;
      path = fields.slice(fieldCount).join(' ');
      const xy = fields[1] ?? '';
      if (type === '2') {
        status = 'renamed';
        const oldPath = records[++i] ?? '';
        if (path && !path.toLowerCase().split('/').includes('.git')) statuses.set(path, { status, oldPath });
        continue;
      }
      status = type === 'u' || xy.includes('U') ? 'conflicted'
        : xy.includes('D') ? 'deleted'
        : xy.includes('A') ? 'added'
        : xy.includes('R') ? 'renamed'
        : 'modified';
    }
    path = path.replace(/\/+$/, '');
    if (path && !path.toLowerCase().split('/').includes('.git')) statuses.set(path, { status });
  }
  return statuses;
}

function directoryStatuses(statuses: Map<string, DirectStatus>): Map<string, GitFileStatus[]> {
  const result = new Map<string, GitFileStatus[]>();
  for (const [path, entry] of statuses) {
    let parent = dirname(path);
    while (parent !== '.' && parent !== '..') {
      const values = result.get(parent) ?? [];
      values.push(entry.status);
      result.set(parent, values);
      parent = dirname(parent);
    }
  }
  return result;
}

function directoryStatus(path: string, statuses: Map<string, DirectStatus>, descendants: Map<string, GitFileStatus[]>): GitFileStatus | undefined {
  const direct = statuses.get(path);
  const childStatuses = descendants.get(path) ?? [];
  if (childStatuses.some(status => status !== 'ignored' && status !== 'untracked')) return 'modified';
  if (direct?.status === 'untracked' || childStatuses.includes('untracked')) return 'untracked';
  if (direct?.status === 'ignored' || (childStatuses.length && childStatuses.every(status => status === 'ignored'))) return 'ignored';
  return direct?.status;
}

export function listFiles(root: string, value = '') {
  const target = resolvePath(root, value);
  let entries: string[];
  try { entries = readdirSync(target.absolute); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw new FileError('file.not_found', `Directory not found: ${target.path || '.'}`);
    throw error;
  }
  let statuses: Map<string, DirectStatus> | undefined;
  if (isGitRepo(target.root)) statuses = gitStatuses(target.root);
  const descendants = statuses ? directoryStatuses(statuses) : undefined;
  const output: Array<{
    name: string; path: string; kind: 'dir' | 'file' | 'symlink'; size: number; mtime: number;
    git?: GitFileStatus;
  }> = [];
  const seen = new Set<string>();

  for (const name of entries) {
    if (name.toLowerCase() === '.git') continue;
    const path = target.path ? `${target.path}/${name}` : name;
    const absolute = join(target.absolute, name);
    let stat;
    try { stat = lstatSync(absolute); } catch { continue; }
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
    const git = statuses
      ? kind === 'dir' ? directoryStatus(path, statuses, descendants!) : statuses.get(path)?.status
      : undefined;
    output.push({
      name, path, kind, size: stat.size, mtime: Math.round(stat.mtimeMs),
      ...(git ? { git } : {}),
    });
    seen.add(path);
  }

  if (statuses) {
    for (const [path, entry] of statuses) {
      if (seen.has(path) || entry.status !== 'deleted') continue;
      if (dirname(path) !== (target.path || '.')) continue;
      const name = basename(path);
      output.push({ name, path, kind: 'file', size: 0, mtime: 0, git: 'deleted' });
    }
  }

  let free: number | null = null;
  try {
    const stats = statfsSync(target.root);
    free = stats.bavail * stats.bsize;
  } catch { /* unavailable on this filesystem */ }
  return { root: resolve(root), path: target.path, entries: output, free };
}

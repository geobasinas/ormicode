import { parsePatch } from '@ormicode/diff';
import { git } from './commands.ts';

const PATCH_LIMIT = 256 * 1024;
const stashRef = (index = 0) => `stash@{${index}}`;
const fileStatus = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' } as const;

function list(cwd: string) {
  const raw = git(cwd, 'stash', 'list', '--format=%gd%x00%gs%x00%ct%x00%H');
  return raw.split('\n').filter(Boolean).map((row, index) => {
    const [ref = '', subject = '', ts = '0', sha = ''] = row.split('\0');
    const branch = /^(?:WIP on |On )(.+?):/.exec(subject)?.[1] ?? null;
    const patch = git(cwd, 'stash', 'show', '--format=', '--patch', '--include-untracked', '-M', sha);
    const files = parsePatch(patch);
    return {
      index, ref, message: subject.replace(/^(?:WIP on |On )[^:]+:\s*/, ''),
      branch, ts: Number(ts) * 1000, files: files.length,
      added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0),
    };
  });
}

function item(cwd: string, index: number) {
  const entry = list(cwd).find(s => s.index === index);
  if (!entry) throw new Error(`stash index ${index} does not exist`);
  return entry;
}

export function stash(cwd: string, options: {
  op: 'list' | 'show' | 'push' | 'pop' | 'apply' | 'drop';
  index?: number; message?: string; includeUntracked?: boolean;
}) {
  const index = options.index ?? 0;
  if (options.op === 'show') {
    const entry = item(cwd, index);
    const patch = git(cwd, 'stash', 'show', '--format=', '--patch', '--include-untracked', '-M', entry.ref);
    const files = parsePatch(patch).map(file => ({
      path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      status: fileStatus[file.status], binary: file.binary, added: file.added, removed: file.removed,
    }));
    return { files, patch: patch.length > PATCH_LIMIT ? patch.slice(0, PATCH_LIMIT) : patch, truncated: patch.length > PATCH_LIMIT };
  }
  if (options.op === 'push') {
    git(cwd, 'stash', 'push', ...(options.includeUntracked ? ['--include-untracked'] : []), ...(options.message ? ['-m', options.message] : []));
  } else if (options.op !== 'list') {
    const op = options.op;
    git(cwd, 'stash', op, stashRef(index));
  }
  return { stashes: list(cwd) };
}

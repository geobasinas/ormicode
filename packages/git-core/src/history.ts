import { parsePatch } from '@ormicode/diff';
import { git, resolveCommit } from './commands.ts';

const PATCH_LIMIT = 256 * 1024;
const fileStatus = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' } as const;

export function log(cwd: string, opts: { ref?: string; limit?: number; skip?: number; path?: string } = {}) {
  const ref = resolveCommit(cwd, opts.ref ?? 'HEAD');
  const limit = opts.limit ?? 50; const skip = opts.skip ?? 0;
  const total = opts.path
    ? git(cwd, 'log', '--follow', '--format=%H', ref, '--', opts.path).split(/\s+/).filter(Boolean).length
    : Number(git(cwd, 'rev-list', '--count', ref).trim());
  const unpushed = new Set(git(cwd, 'rev-list', ref, '--not', '--remotes').split(/\s+/).filter(Boolean));
  const format = '%x1e%H%x00%s%x00%an%x00%ae%x00%at%x00%P%x00%D%x00%B%x00';
  const raw = git(cwd, 'log', ...(opts.path ? ['--follow'] : []), `--format=${format}`, `--max-count=${limit}`, `--skip=${skip}`, ref, ...(opts.path ? ['--', opts.path] : []));
  const commits = raw.split('\x1e').filter(Boolean).map(row => {
    const [sha = '', subject = '', author = '', email = '', ts = '0', parents = '', decorations = '', ...rest] = row.split('\0');
    const body = rest.join('\0').replace(/\n$/, '');
    const session = /^Ormi-Session:\s*(\S+)\s*$/mi.exec(body)?.[1];
    return {
      sha, subject, author, email, ts: Number(ts) * 1000,
      parents: parents.trim() ? parents.trim().split(/\s+/) : [],
      refs: decorations.split(',').map(r => r.trim()).filter(Boolean),
      pushed: !unpushed.has(sha), ...(session ? { session } : {}),
    };
  });
  return { commits, total };
}

export function show(cwd: string, value: string) {
  const sha = resolveCommit(cwd, value);
  const [subject = '', body = '', author = '', ts = '0', parents = ''] =
    git(cwd, 'show', '-s', '--format=%s%x00%b%x00%an%x00%ct%x00%P', sha).split('\0');
  const parentList = parents.trim() ? parents.trim().split(/\s+/) : [];
  const patch = parentList.length
    ? git(cwd, 'diff', '--no-ext-diff', '--no-color', '-M', parentList[0]!, sha)
    : git(cwd, 'diff-tree', '--root', '--no-commit-id', '-p', '-M', '--no-color', '--no-ext-diff', sha);
  const files = parsePatch(patch).map(file => ({
    path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    status: fileStatus[file.status], binary: file.binary, added: file.added, removed: file.removed,
  }));
  return {
    sha, subject, body: body.trimEnd(), author, ts: Number(ts) * 1000, parents: parentList, files,
    patch: patch.length > PATCH_LIMIT ? patch.slice(0, PATCH_LIMIT) : patch,
    truncated: patch.length > PATCH_LIMIT,
  };
}

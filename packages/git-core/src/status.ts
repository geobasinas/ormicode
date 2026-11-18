import { currentBranch, git } from './commands.ts';

export interface GitStatus {
  branch: string | null; base: string | null; upstream: string | null;
  ahead: number; behind: number; aheadOfBase: number;
  files: { path: string; oldPath?: string; status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'; staged: boolean; unstaged: boolean }[];
  staged: { added: number; removed: number; files: number };
}

function fileStatus(xy: string): 'M' | 'A' | 'D' | 'R' | 'U' {
  if (xy.includes('U')) return 'U';
  if (xy.includes('R')) return 'R';
  if (xy.includes('D')) return 'D';
  if (xy.includes('A')) return 'A';
  return 'M';
}

function stagedStat(cwd: string): GitStatus['staged'] {
  const rows = git(cwd, 'diff', '--cached', '--numstat', '-z', '-M').split('\0');
  let added = 0; let removed = 0; let files = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row) continue;
    const cols = row.split('\t');
    if (cols.length !== 3) continue;
    files++;
    if (cols[0] !== '-') added += Number(cols[0]);
    if (cols[1] !== '-') removed += Number(cols[1]);
    if (!cols[2]) i += 2;
  }
  return { added, removed, files };
}

export function status(cwd: string, base: string | null): GitStatus {
  const records = git(cwd, 'status', '--porcelain=v2', '-z', '--branch').split('\0');
  let branch = currentBranch(cwd);
  let upstream: string | null = null; let ahead = 0; let behind = 0;
  const files: GitStatus['files'] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length);
      branch = head === '(detached)' ? null : head;
    } else if (record.startsWith('# branch.upstream ')) upstream = record.slice('# branch.upstream '.length);
    else if (record.startsWith('# branch.ab ')) {
      const m = /^\+(\d+) -(\d+)$/.exec(record.slice('# branch.ab '.length));
      if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
    } else if (record.startsWith('? ')) files.push({ path: record.slice(2), status: '?', staged: false, unstaged: true });
    else if (record.startsWith('1 ')) {
      const m = /^1 (\S+) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(record);
      if (m) files.push({ path: m[2]!, status: fileStatus(m[1]!), staged: m[1]![0] !== '.', unstaged: m[1]![1] !== '.' });
    } else if (record.startsWith('2 ')) {
      const m = /^2 (\S+) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(record);
      if (m) {
        const oldPath = records[++i] ?? '';
        files.push({ path: m[2]!, ...(oldPath ? { oldPath } : {}), status: 'R', staged: m[1]![0] !== '.', unstaged: m[1]![1] !== '.' });
      }
    } else if (record.startsWith('u ')) {
      const m = /^u (\S+) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/.exec(record);
      if (m) files.push({ path: m[2]!, status: 'U', staged: true, unstaged: true });
    }
  }
  let aheadOfBase = 0;
  if (base) {
    try { aheadOfBase = Number(git(cwd, 'rev-list', '--count', `${base}..HEAD`).trim()); }
    catch { aheadOfBase = 0; }
  }
  return { branch, base, upstream, ahead, behind, aheadOfBase, files, staged: stagedStat(cwd) };
}

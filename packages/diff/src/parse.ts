// Unified-diff parser (git diff output): per-file status, renames, binaries,
// hunks and +/- counts. Pure: no git, no fs.
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export interface Hunk { header: string; oldStart: number; newStart: number; lines: string[] }
export interface FilePatch { path: string; oldPath?: string; status: FileStatus; binary: boolean; added: number; removed: number; hunks: Hunk[] }

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) as string : p);
const strip = (p: string) => unquote(p).replace(/^[ab]\//, '');

export function parsePatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let file: FilePatch | undefined; let hunk: Hunk | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/.exec(line);
      file = { path: m ? strip(m[2]!) : line.slice(11), status: 'modified', binary: false, added: 0, removed: 0, hunks: [] };
      files.push(file); hunk = undefined; continue;
    }
    if (!file) continue;
    if (hunk && /^[ +\-\\]/.test(line) && !line.startsWith('--- ') && !line.startsWith('+++ ')) {
      hunk.lines.push(line);
      if (line.startsWith('+')) file.added++; else if (line.startsWith('-')) file.removed++;
      continue;
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { hunk = { header: line, oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] }; file.hunks.push(hunk); continue; }
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = unquote(line.slice(12)); }
    else if (line.startsWith('rename to ')) file.path = unquote(line.slice(10));
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
    else if (line.startsWith('+++ ') && line !== '+++ /dev/null') file.path = strip(line.slice(4));
  }
  return files;
}

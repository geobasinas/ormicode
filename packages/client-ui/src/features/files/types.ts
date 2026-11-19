/** Wire shapes of the daemon's file.* methods (see packages/protocol). */
export type GitMark = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflicted';
export interface Entry { name: string; path: string; kind: 'dir' | 'file' | 'symlink'; size: number; mtime: number; git?: GitMark }
export interface Listing { root: string; path: string; entries: Entry[]; free: number | null }
export interface FileData {
  path: string; size: number; mtime: number | null; binary: boolean; mime: string | null;
  encoding: 'utf8' | 'base64' | null; content: string | null; tooLarge: boolean;
}
export interface NameHit { path: string; score: number; positions: number[] }
export interface TextHit { path: string; line: number; text: string; ranges: [number, number][] }
export interface Blame { hunks: { start: number; count: number; sha: string }[]; commits: Record<string, { author: string; ts: number; summary: string; session?: string }> }
export interface FileCommit { sha: string; subject: string; author: string; ts: number; session?: string }

export const GIT_COLOR: Partial<Record<GitMark, string>> = {
  modified: 'var(--text-secondary)', renamed: 'var(--text-secondary)', added: 'var(--accent-mint)', untracked: 'var(--accent-mint)',
  deleted: 'var(--accent-red)', conflicted: 'var(--accent-red)',
};
export const GIT_LETTER: Partial<Record<GitMark, string>> = { modified: 'M', renamed: 'R', added: 'A', untracked: 'U', deleted: 'D', conflicted: '!' };

export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const joinPath = (a: string, b: string) => (a ? `${a}/${b}` : b);

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function typeLabel(e: Entry): string {
  if (e.kind === 'dir') return 'Folder';
  if (e.kind === 'symlink') return 'Link';
  const dot = e.name.lastIndexOf('.');
  return dot > 0 ? `${e.name.slice(dot + 1).toUpperCase()} file` : 'File';
}

/** Folders first, then case-insensitive name order (dotfiles sort with the rest). */
export function sortEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

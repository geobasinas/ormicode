import { resolve } from 'node:path';

export interface WorktreeEntry { path: string; branch: string | null }

export function parseWorktrees(text: string): WorktreeEntry[] {
  return text.split(/\r?\n\r?\n/).map(record => {
    const lines = record.split(/\r?\n/);
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length);
    if (!path) return undefined;
    const ref = lines.find(line => line.startsWith('branch '))?.slice('branch '.length);
    // git prints forward slashes on Windows; normalize so API consumers can
    // compare against join()/resolve() paths directly.
    return { path: resolve(path), branch: ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null };
  }).filter((entry): entry is WorktreeEntry => Boolean(entry));
}

export function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'ws';
}

export function worktreeSlug(name: string): string {
  return sanitize(name).replace(/[./]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ws';
}

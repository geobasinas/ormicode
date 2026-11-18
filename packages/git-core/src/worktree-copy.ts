import {
  chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commandMessage, gitResult, run } from './worktree-process.ts';
import type { WorkspaceStep } from './worktree.ts';

async function safeCopyPath(sourceRoot: string, targetRoot: string, path: string): Promise<void> {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error(`unsafe path ${path}`);
  const source = resolve(sourceRoot, ...parts);
  const target = resolve(targetRoot, ...parts);
  const sourceRelative = relative(sourceRoot, source);
  const targetRelative = relative(targetRoot, target);
  if (isAbsolute(sourceRelative) || sourceRelative.startsWith(`..${sep}`) || sourceRelative === '..'
    || isAbsolute(targetRelative) || targetRelative.startsWith(`..${sep}`) || targetRelative === '..')
    throw new Error(`path escapes workspace: ${path}`);

  let parent = targetRoot;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    try {
      const existing = await lstat(parent);
      if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error(`unsafe destination parent for ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(parent);
    }
  }
  const sourceStat = await lstat(source);
  try { await rm(target, { recursive: true, force: true }); } catch { /* best effort */ }
  if (sourceStat.isSymbolicLink()) await symlink(await readlink(source), target);
  else if (sourceStat.isDirectory()) await mkdir(target, { recursive: true });
  else if (sourceStat.isFile()) {
    await copyFile(source, target);
    await chmod(target, sourceStat.mode & 0o777);
  } else throw new Error(`unsupported file type: ${path}`);
}

export async function copyDirty(project: string, target: string): Promise<number> {
  const patch = await gitResult(project, ['diff', '--binary', 'HEAD']);
  if (patch.code !== 0) throw new Error(commandMessage(patch));
  if (patch.stdout.length) {
    const applied = await gitResult(target, ['apply'], patch.stdout);
    if (applied.code !== 0) throw new Error(commandMessage(applied));
  }
  const listed = await gitResult(project, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (listed.code !== 0) throw new Error(commandMessage(listed));
  const paths = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  for (const path of paths) await safeCopyPath(project, target, path);
  return paths.length;
}

async function matchingIncludePaths(patterns: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const temp = await mkdtemp(join(tmpdir(), 'ormi-worktreeinclude-'));
  try {
    await writeFile(join(temp, '.gitignore'), patterns);
    const init = await run('git', ['init', '-q'], { cwd: temp });
    if (init.code !== 0) throw new Error(commandMessage(init));
    const input = Buffer.from(`${paths.join('\0')}\0`);
    const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const checked = await run('git', ['-c', `core.excludesFile=${nullConfig}`, 'check-ignore', '--no-index', '-z', '--stdin'], {
      cwd: temp, input,
    });
    if (checked.code !== 0 && checked.code !== 1) throw new Error(commandMessage(checked));
    return checked.stdout.toString('utf8').split('\0').filter(Boolean);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function includeIgnored(project: string, target: string): Promise<WorkspaceStep> {
  const includeFile = join(project, '.worktreeinclude');
  let patterns: string;
  try { patterns = await readFile(includeFile, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { step: 'include', status: 'skipped', detail: '.worktreeinclude not found' };
    throw error;
  }
  const listed = await gitResult(project, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
  if (listed.code !== 0) throw new Error(commandMessage(listed));
  const candidates = listed.stdout.toString('utf8').split('\0').filter(Boolean);
  const matches = await matchingIncludePaths(patterns, candidates);
  const copied: string[] = [];
  const oversized: string[] = [];
  for (const path of matches) {
    const source = resolve(project, ...path.replace(/\\/g, '/').split('/'));
    const details = await stat(source);
    if (details.size > 50 * 1024 * 1024) { oversized.push(path); continue; }
    await safeCopyPath(project, target, path);
    copied.push(path);
  }
  if (oversized.length)
    return { step: 'include', status: 'warn', detail: `copied ${copied.length}; skipped files over 50 MB: ${oversized.join(', ')}` };
  if (copied.length) return { step: 'include', status: 'ok', detail: `copied ${copied.length} ignored file${copied.length === 1 ? '' : 's'}` };
  return { step: 'include', status: 'skipped', detail: 'no ignored files matched .worktreeinclude' };
}

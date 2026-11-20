import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { getSession, type Store } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';
import { ormicodeDir } from './socket.ts';

type CopyOutCode = 'session.not_scratch' | 'copy_out.invalid_project' | 'copy_out.invalid_path' | 'copy_out.conflict' | 'copy_out.failed';

export function scratchWorkspaceInUse(db: Store, cwd: string, excluding: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sessions WHERE cwd = ? AND id != ? AND
    (archived = 0 OR state IN ('starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited')) LIMIT 1`).get(cwd, excluding));
}

class CopyOutError extends Error {
  readonly code: CopyOutCode;
  constructor(code: CopyOutCode, message: string) { super(message); this.code = code; }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function containedPath(root: string, value: string, label: string, allowRoot = false): { absolute: string; relative: string } {
  if (typeof value !== 'string' || value.includes('\0') || isAbsolute(value) || win32.isAbsolute(value))
    throw new CopyOutError('copy_out.invalid_path', `${label} must be a relative path`);
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts.some(part => part === '..')) throw new CopyOutError('copy_out.invalid_path', `${label} cannot contain ..`);
  const normalized = parts.filter(part => part && part !== '.').join(sep);
  if (!normalized && !allowRoot) throw new CopyOutError('copy_out.invalid_path', `${label} must name a file or folder`);
  const absolute = resolve(root, normalized || '.');
  if (!within(root, absolute) || (!allowRoot && absolute === root))
    throw new CopyOutError('copy_out.invalid_path', `${label} is outside its allowed folder`);
  return { absolute, relative: relative(root, absolute).split(sep).join('/') };
}

function lstatMaybe(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function assertProjectPath(root: string, target: string): void {
  if (!within(root, target)) throw new CopyOutError('copy_out.invalid_path', 'destination is outside the project folder');
  let cursor = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (!lstatMaybe(cursor)) break;
    if (!within(root, realpathSync(cursor)))
      throw new CopyOutError('copy_out.invalid_path', 'destination crosses a symlink outside the project folder');
  }
}

function assertScratchPath(root: string, target: string): void {
  if (!within(root, realpathSync(target)))
    throw new CopyOutError('copy_out.invalid_path', 'source crosses a symlink outside the scratch folder');
}

function walkScratch(root: string, path: string, relativePath: string): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new CopyOutError('copy_out.invalid_path', `symbolic links cannot be copied: ${relativePath}`);
  assertScratchPath(root, path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) walkScratch(root, join(path, name), relativePath ? `${relativePath}/${name}` : name);
    return true;
  }
  if (!stat.isFile()) throw new CopyOutError('copy_out.invalid_path', `unsupported file type: ${relativePath}`);
  return false;
}

function copyPath(scratchRoot: string, projectRoot: string, source: string, target: string, overwrite: boolean): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new CopyOutError('copy_out.invalid_path', 'symbolic links cannot be copied');
  assertScratchPath(scratchRoot, source);
  assertProjectPath(projectRoot, target);
  const existing = lstatMaybe(target);
  if (existing) {
    if (!overwrite) throw new CopyOutError('copy_out.conflict', `destination already exists: ${relative(projectRoot, target).split(sep).join('/')}`);
    rmSync(target, { recursive: true, force: true });
  }
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source))
      copyPath(scratchRoot, projectRoot, join(source, name), join(target, name), overwrite);
    return;
  }
  if (!stat.isFile()) throw new CopyOutError('copy_out.invalid_path', 'unsupported file type');
  mkdirSync(dirname(target), { recursive: true });
  assertProjectPath(projectRoot, target);
  copyFileSync(source, target);
}

export function countScratchFiles(root: string): number {
  let count = 0;
  const visit = (path: string) => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() || entry.isSymbolicLink()) count++;
    }
  };
  visit(root);
  return count;
}

export function copyOutMethod(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): void {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  if (row.project !== 'scratch') return client.link.replyError(id, 'session.not_scratch', 'Copy to project is available only for no-project sessions');
  if (['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'].includes(row.state))
    return client.link.replyError(id, 'session.busy', 'stop the running turn before copying files');

  try {
    const scratchRoot = resolve(join(ormicodeDir(), 'scratch'));
    const parent = row.parent ? getSession(ctx.db, row.parent) : undefined;
    const owner = parent?.project === 'scratch' && parent.cwd === row.cwd ? parent.id : session;
    if (!existsSync(scratchRoot) || resolve(row.cwd) !== resolve(scratchRoot, owner))
      throw new CopyOutError('copy_out.invalid_path', 'scratch folder is unavailable');
    const realScratchRoot = realpathSync(scratchRoot);
    const sourceRoot = realpathSync(row.cwd);
    if (!within(realScratchRoot, sourceRoot) || sourceRoot === realScratchRoot)
      throw new CopyOutError('copy_out.invalid_path', 'session scratch folder is outside the scratch root');

    const requestedProject = String(body.project);
    if (!isAbsolute(requestedProject) || requestedProject === 'scratch' || !existsSync(requestedProject))
      throw new CopyOutError('copy_out.invalid_project', `project folder not found: ${requestedProject}`);
    const projectRoot = realpathSync(requestedProject);
    if (!lstatSync(projectRoot).isDirectory() || within(realScratchRoot, projectRoot))
      throw new CopyOutError('copy_out.invalid_project', 'choose an existing project folder outside scratch');

    const destination = containedPath(projectRoot, String(body.dest ?? ''), 'destination', true);
    assertProjectPath(projectRoot, destination.absolute);
    const paths = body.paths as string[];
    const selected = paths.map(path => {
      const source = containedPath(sourceRoot, path, 'source path');
      walkScratch(sourceRoot, source.absolute, source.relative);
      return { ...source, isDirectory: lstatSync(source.absolute).isDirectory() };
    });
    if (new Set(selected.map(item => item.relative)).size !== selected.length)
      throw new CopyOutError('copy_out.invalid_path', 'duplicate source paths are not allowed');
    const roots = selected.filter(item => !selected.some(parent =>
      parent.isDirectory && parent.relative !== item.relative && item.relative.startsWith(`${parent.relative}/`)));
    const plans = roots.map(item => ({
      from: item.relative,
      to: [destination.relative, item.relative].filter(Boolean).join('/'),
      source: item.absolute,
      target: resolve(destination.absolute, item.relative),
    }));
    for (const plan of plans) assertProjectPath(projectRoot, plan.target);
    const conflicts = plans.filter(plan => lstatMaybe(plan.target)).map(plan => plan.to);
    if (conflicts.length && body.overwrite !== true)
      throw new CopyOutError('copy_out.conflict', `destination already exists: ${conflicts.join(', ')}`);
    for (const plan of plans) copyPath(realScratchRoot, projectRoot, plan.source, plan.target, body.overwrite === true);
    return client.link.reply(id, { copied: plans.map(({ from, to }) => ({ from, to })) });
  } catch (error) {
    if (error instanceof CopyOutError) return client.link.replyError(id, error.code, error.message);
    return client.link.replyError(id, 'copy_out.failed', error instanceof Error ? error.message : String(error));
  }
}

import { readdir, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { addProject, listProjects, removeProject } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';

const LOCAL_MACHINE = 'm_local';
const MAX_ENTRIES = 2_000;

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function fsError(client: Client, id: string, error: unknown): void {
  const code = errorCode(error);
  const mapped = code === 'ENOENT' ? 'fs.not_found'
    : code === 'ENOTDIR' ? 'fs.not_directory'
      : code === 'EACCES' || code === 'EPERM' ? 'fs.denied' : 'fs.denied';
  const message = mapped === 'fs.not_found' ? 'folder not found'
    : mapped === 'fs.not_directory' ? 'path is not a folder'
      : mapped === 'fs.denied' ? 'permission denied' : 'invalid path';
  client.link.replyError(id, mapped, message);
}

async function hasGit(path: string): Promise<boolean> {
  try { const entry = await stat(resolve(path, '.git')); return entry.isDirectory() || entry.isFile(); }
  catch { return false; }
}

async function browse(client: Client, id: string, body: Record<string, unknown>): Promise<void> {
  const rawPath = typeof body.path === 'string' ? body.path : homedir();
  if (!isAbsolute(rawPath)) return client.link.replyError(id, 'fs.invalid_path', 'path must be absolute');
  const path = resolve(rawPath);
  try {
    const folder = await stat(path);
    if (!folder.isDirectory()) {
      const error = Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
      throw error;
    }
  } catch (error) { return fsError(client, id, error); }
  const hidden = body.hidden === true;
  let names: string[];
  try { names = await readdir(path); }
  catch (error) { return fsError(client, id, error); }
  names = names.filter(name => hidden || !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b));
  const entries: { name: string; path: string; git: boolean; hidden: boolean }[] = [];
  let truncated = false;
  for (const name of names) {
    const entryPath = resolve(path, name);
    try { if (!(await stat(entryPath)).isDirectory()) continue; }
    catch { continue; }
    if (entries.length === MAX_ENTRIES) { truncated = true; break; }
    entries.push({ name, path: entryPath, git: false, hidden: name.startsWith('.') });
  }
  await Promise.all(entries.map(async entry => { entry.git = await hasGit(entry.path); }));
  const parent = dirname(path);
  client.link.reply(id, {
    machine: LOCAL_MACHINE, path, parent: parent === path ? null : parent,
    home: homedir(), entries, truncated,
  });
}

function localMachine(ctx: DispatchCtx) {
  return { id: LOCAL_MACHINE, name: hostname() || 'local', kind: 'local', status: 'online', heartbeat: Date.now(), resources: ctx.resources.status() };
}

export async function machineMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  if (method === 'machine.list') return client.link.reply(id, { machines: [localMachine(ctx)] });
  if (method === 'machine.status') {
    const machine = String(body.machine);
    if (machine !== LOCAL_MACHINE) return client.link.replyError(id, 'machine.unreachable', machine);
    return client.link.reply(id, { machine: localMachine(ctx) });
  }
  if (method === 'machine.projects') {
    const machine = String(body.machine);
    if (machine !== LOCAL_MACHINE) return client.link.replyError(id, 'machine.unreachable', machine);
    return client.link.reply(id, { projects: listProjects(ctx.db).filter(p => p.machine === machine).map(p => ({ identity: p.path, path: p.path })) });
  }
  if (method === 'project.list') {
    const projects = await Promise.all(listProjects(ctx.db).map(async project => ({ ...project, git: await hasGit(project.path) })));
    return client.link.reply(id, { projects });
  }
  const machine = String(body.machine);
  if (machine !== LOCAL_MACHINE) return client.link.replyError(id, 'machine.unreachable', machine);
  if (method === 'fs.browse') return browse(client, id, body);
  const path = String(body.path);
  if (method === 'project.remove')
    return client.link.reply(id, { removed: removeProject(ctx.db, machine, path) });
  if (!isAbsolute(path)) return client.link.replyError(id, 'fs.invalid_path', 'path must be absolute');
  const normalized = resolve(path);
  try {
    if (!(await stat(normalized)).isDirectory())
      return client.link.replyError(id, 'fs.not_directory', 'path is not a folder');
  } catch (error) { return fsError(client, id, error); }
  const stored = addProject(ctx.db, { machine, path: normalized, name: basename(normalized) || normalized, addedAt: Date.now() });
  return client.link.reply(id, { project: { ...stored, git: await hasGit(stored.path) } });
}

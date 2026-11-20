/**
 * `ormi export` and `ormi wipe` (README: Storage and settings). Both stay
 * inside ORMICODE_HOME: paths are resolved against the real home, symlinks
 * are never followed out of it, and temp files live in the home itself.
 */
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { snapshotStore, storeInUse, type Store } from '@ormicode/session-store';

export const WIPE_CONFIRM = 'wipe';

/** What `ormi wipe` removes: store, logs, cache, keys, and session data that only makes sense with the store. */
export const WIPE_TARGETS = [
  'store.db', 'store.db-wal', 'store.db-shm', 'store.db-journal', 'blobs',
  'logs', 'cache',
  'hub.json', 'remote.json', 'device.token', 'device-id', join('desktop', 'device.token'), join('desktop', 'remote.json'),
  'notes', 'checkpoints', 'terminals', 'recordings', 'artifacts',
];
/** Left alone so a wipe never takes your own files, settings or the installed app. */
export const WIPE_KEEPS = ['config.json', 'scratch/', 'skills/', 'teams/', 'automations.json', 'destructive.json', 'mcp/', 'versions/', 'OS keyring secrets'];

export class ConfirmationError extends Error {}

/** True while the daemon (or anything else) has home's store open. */
export function storeBusy(home: string): boolean {
  return storeInUse(join(home, 'store.db'));
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Real home path; refuses a missing home rather than creating one. */
function realHome(home: string): string {
  return realpathSync(home);
}

/** A regular file inside home, reached without leaving it through a symlink. */
function safeFile(root: string, rel: string): string | undefined {
  const path = join(root, rel);
  let stat;
  try { stat = lstatSync(path); } catch { return undefined; }
  if (!stat.isFile()) return undefined;
  return within(root, realpathSync(path)) ? path : undefined;
}

function tempName(root: string, prefix: string, suffix = ''): string {
  return join(root, `${prefix}${randomBytes(6).toString('hex')}${suffix}`);
}

// Minimal ustar writer: names are short and ASCII, so no long-name extensions.
function tarHeader(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512);
  const put = (value: string, offset: number, length: number) => h.write(value, offset, length, 'ascii');
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0');
  put(name, 0, 100); put(octal(0o600, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12); put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8); put('0', 156, 1); put('ustar\u000000', 257, 8);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(`${octal(sum, 7)}\u0000`, 148, 8);
  return h;
}

function appendFile(out: number, name: string, path: string): number {
  const fd = openSync(path, 'r');
  try {
    const { size, mtimeMs } = fstatSync(fd);
    writeSync(out, tarHeader(name, size, mtimeMs));
    const chunk = Buffer.alloc(1 << 20);
    let done = 0;
    while (done < size) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, size - done), done);
      if (n === 0) throw new Error(`${name} shrank while exporting`);
      writeSync(out, chunk, 0, n); done += n;
    }
    if (size % 512) writeSync(out, Buffer.alloc(512 - (size % 512)));
    return size;
  } finally { closeSync(fd); }
}

function appendBuffer(out: number, name: string, data: Buffer): void {
  writeSync(out, tarHeader(name, data.length, Date.now()));
  writeSync(out, data);
  if (data.length % 512) writeSync(out, Buffer.alloc(512 - (data.length % 512)));
}

const SECRET_KEY = /token|secret|password|passwd|credential|api[-_]?key|private[-_]?key/i;
/** config.json holds machine settings, not credentials, but drop anything named like one anyway. */
function scrubbed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubbed);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, item]) => [key, scrubbed(item)]));
}

export interface ExportResult { files: string[]; skipped: string[] }

/**
 * Writes a tar of the store snapshot, config.json and the daemon log to `out`.
 * Never includes tokens, key files or logs/sessions. Pass the daemon's open
 * store as `db` so the snapshot comes from the same connection.
 */
export function writeExport(home: string, out: string, db?: Store): ExportResult {
  const root = realHome(home);
  const files: string[] = [];
  const skipped: string[] = [];
  const snapshot = tempName(root, '.export-store-', '.db');
  const fd = openSync(out, 'wx', 0o600);
  try {
    const store = safeFile(root, 'store.db');
    if (store || db) {
      snapshotStore(db ?? store!, snapshot);
      appendFile(fd, 'store.db', snapshot); files.push('store.db');
    } else skipped.push('store.db (missing)');
    const config = safeFile(root, 'config.json');
    if (config) {
      try {
        appendBuffer(fd, 'config.json', Buffer.from(JSON.stringify(scrubbed(JSON.parse(readFileSync(config, 'utf8'))), null, 2)));
        files.push('config.json');
      } catch { skipped.push('config.json (not valid JSON)'); }
    }
    const logs = join(root, 'logs');
    if (existsSync(logs) && lstatSync(logs).isDirectory()) {
      for (const name of readdirSync(logs).filter(n => /^daemon\.log(\.\d+)?$/.test(n)).sort()) {
        const path = safeFile(root, join('logs', name));
        if (path) { appendFile(fd, `logs/${name}`, path); files.push(`logs/${name}`); }
      }
    }
    const manifest = {
      format: 'ormicode-export', version: 1, createdAt: new Date().toISOString(), files, skipped,
      excluded: ['tokens and key files (hub.json, remote.json, device.token, desktop/)', 'device token hashes in the store', 'logs/sessions/**', 'keyring secret values'],
    };
    appendBuffer(fd, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    writeSync(fd, Buffer.alloc(1024));
  } catch (error) {
    closeSync(fd); rmSync(out, { force: true });
    throw error;
  } finally {
    rmSync(snapshot, { force: true });
  }
  closeSync(fd);
  return { files, skipped };
}

/** Writes an export into a temp file inside home and returns its path. */
export function writeExportInHome(home: string, db?: Store): { path: string } & ExportResult {
  const path = tempName(realHome(home), '.export-', '.tar');
  return { path, ...writeExport(home, path, db) };
}

export function exportFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ormicode-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.tar`;
}

export interface WipeResult { removed: string[]; kept: string[]; leftover?: string }

/**
 * Deletes WIPE_TARGETS from home. Only runs with the exact confirmation word,
 * and only once nothing holds the store open (the caller checks that). Every
 * target is first moved into one staging folder inside home; if any move
 * fails, the moves are undone, so home is either fully wiped or untouched.
 */
export function wipeHome(home: string, confirm: string): WipeResult {
  if (confirm !== WIPE_CONFIRM) throw new ConfirmationError(`type "${WIPE_CONFIRM}" to confirm`);
  const root = realHome(home);
  for (const stale of readdirSync(root).filter(n => n.startsWith('.wipe-'))) rmSync(join(root, stale), { recursive: true, force: true });
  const present = WIPE_TARGETS.filter(rel => {
    try { lstatSync(join(root, rel)); } catch { return false; }
    // The parent must be the real folder inside home (desktop/ could be a symlink elsewhere).
    if (realpathSync(dirname(join(root, rel))) !== dirname(join(root, rel))) throw new Error(`refusing to wipe ${rel}: its folder leaves ${root}`);
    return true;
  });
  const staging = tempName(root, '.wipe-');
  mkdirSync(staging, { mode: 0o700 });
  const moved: [string, string][] = [];
  try {
    for (const [index, rel] of present.entries()) {
      const to = join(staging, String(index));
      renameSync(join(root, rel), to);
      moved.push([join(root, rel), to]);
    }
  } catch (error) {
    for (const [from, to] of moved.reverse()) renameSync(to, from);
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`nothing was deleted: ${(error as Error).message}`, { cause: error });
  }
  const removed = present.map(rel => rel.split(sep).join('/'));
  try { rmSync(staging, { recursive: true, force: true }); }
  catch { return { removed, kept: WIPE_KEEPS, leftover: staging }; }
  return { removed, kept: WIPE_KEEPS };
}

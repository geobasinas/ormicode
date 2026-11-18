import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { isBinaryFileSync } from 'isbinaryfile';
import { FileError } from './errors.ts';
import { resolvePath } from './paths.ts';

export interface WriteTarget {
  root: string;
  path: string;
  absolute: string;
  baseMtime?: number;
  mode?: number;
}

export function prepareWrite(root: string, value: string, content: string, baseMtime?: number): WriteTarget {
  const safe = resolvePath(root, value, true);
  let mode: number | undefined;
  if (existsSync(safe.absolute)) {
    const stat = statSync(safe.absolute);
    if (!stat.isFile()) throw new FileError('file.not_found', `Not a regular file: ${safe.path}`);
    const fd = openSync(safe.absolute, 'r');
    try {
      const prefix = Buffer.alloc(512);
      const length = readSync(fd, prefix, 0, prefix.length, 0);
      if (isBinaryFileSync(prefix.subarray(0, length)))
        throw new FileError('file.binary', `Cannot write binary file: ${safe.path}`);
    } finally { closeSync(fd); }
    if (baseMtime !== undefined && Math.abs(baseMtime - Math.round(stat.mtimeMs)) > 1)
      throw new FileError('file.conflict', `File changed since it was opened: ${safe.path}`);
    mode = stat.mode & 0o7777;
  } else if (baseMtime !== undefined) {
    throw new FileError('file.conflict', `File no longer exists: ${safe.path}`);
  }
  return {
    root: safe.root, path: safe.path, absolute: safe.absolute,
    ...(baseMtime === undefined ? {} : { baseMtime }),
    ...(mode === undefined ? {} : { mode }),
  };
}

export function writeFile(target: WriteTarget, content: string) {
  const safe = resolvePath(target.root, target.path, true);
  if (safe.absolute !== target.absolute) throw new FileError('file.conflict', `File path changed before writing: ${target.path}`);
  if (target.baseMtime !== undefined) {
    if (!existsSync(target.absolute) || Math.abs(target.baseMtime - Math.round(statSync(target.absolute).mtimeMs)) > 1)
      throw new FileError('file.conflict', `File changed since it was opened: ${target.path}`);
  }
  const parent = dirname(target.absolute);
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.ormicode-${randomBytes(8).toString('hex')}.tmp`);
  let renamed = false;
  try {
    writeFileSync(temporary, content, { mode: target.mode ?? 0o666 });
    if (target.mode !== undefined) chmodSync(temporary, target.mode);
    renameSync(temporary, target.absolute);
    renamed = true;
  } finally {
    if (!renamed) rmSync(temporary, { force: true });
  }
  const stat = statSync(target.absolute);
  return { path: target.path, size: Buffer.byteLength(content), mtime: Math.round(stat.mtimeMs) };
}

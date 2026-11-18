import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { FileError } from './errors.ts';

export interface SafePath {
  root: string;
  path: string;
  absolute: string;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function hasGitSegment(value: string): boolean {
  return value.split(/[\\/]/).some(part => part.toLowerCase() === '.git');
}

function assertNoGit(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (hasGitSegment(rel) || basenameIsGit(root)) throw new FileError('file.outside', 'Git metadata is not accessible');
}

function basenameIsGit(value: string): boolean {
  return value.slice(value.lastIndexOf(sep) + 1).toLowerCase() === '.git';
}

export function normalizePath(value: string): string {
  if (value.includes('\0')) throw new FileError('file.outside', 'NUL bytes are not allowed in paths');
  const wire = value.replace(/\\/g, '/');
  if (wire.startsWith('/') || /^[a-z]:/i.test(wire) || isAbsolute(value))
    throw new FileError('file.outside', 'Absolute paths are not allowed');

  const parts: string[] = [];
  for (const part of wire.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new FileError('file.outside', 'Path escapes the session root');
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const result = parts.join('/');
  if (hasGitSegment(result)) throw new FileError('file.outside', 'Git metadata is not accessible');
  return result;
}

export function resolvePath(root: string, value: string, allowMissing = false): SafePath {
  const path = normalizePath(value);
  let realRoot: string;
  try { realRoot = realpathSync(root); }
  catch { throw new FileError('file.not_found', 'Session root does not exist'); }
  if (basenameIsGit(realRoot)) throw new FileError('file.outside', 'Git metadata is not accessible');

  const absolute = resolve(realRoot, ...path.split('/').filter(Boolean));
  if (!inside(realRoot, absolute)) throw new FileError('file.outside', 'Path escapes the session root');

  if (existsSync(absolute)) {
    const real = realpathSync(absolute);
    if (!inside(realRoot, real)) throw new FileError('file.outside', 'Path resolves outside the session root');
    assertNoGit(realRoot, real);
    return { root: realRoot, path, absolute: real };
  }

  try {
    lstatSync(absolute);
    throw new FileError('file.outside', 'Unresolvable symbolic links are not allowed');
  } catch (error) {
    if (error instanceof FileError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (!allowMissing) throw new FileError('file.not_found', `Path not found: ${path || '.'}`);

  let ancestor = dirname(absolute);
  while (!existsSync(ancestor) && ancestor !== realRoot) ancestor = dirname(ancestor);
  let realAncestor: string;
  try { realAncestor = realpathSync(ancestor); }
  catch { throw new FileError('file.not_found', 'Parent directory does not exist'); }
  if (!inside(realRoot, realAncestor)) throw new FileError('file.outside', 'Parent resolves outside the session root');
  assertNoGit(realRoot, absolute);
  return { root: realRoot, path, absolute };
}

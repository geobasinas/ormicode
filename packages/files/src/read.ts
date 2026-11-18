import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { isBinaryFileSync } from 'isbinaryfile';
import mime from 'mime';
import { FileError } from './errors.ts';
import { resolvePath } from './paths.ts';

const TEXT_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const HARD_LIMIT = 10 * 1024 * 1024;

function readLimited(path: string, size: number, limit: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const count = Math.min(limit + 1, size + 1);
    const buffer = Buffer.alloc(count);
    const bytes = readSync(fd, buffer, 0, count, 0);
    return buffer.subarray(0, bytes);
  } finally { closeSync(fd); }
}

function gitOutput(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true,
  }).trim();
}

function blobPrefix(root: string, object: string, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, 'show', object], { windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      const take = chunk.subarray(0, Math.max(0, limit - bytes));
      if (take.length) chunks.push(take);
      bytes += take.length;
      if (bytes >= limit) child.kill();
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2048); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 && bytes < limit) reject(new FileError('file.not_found', stderr || 'Git blob not found'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function readBlob(root: string, object: string, size: number): Buffer {
  return execFileSync('git', ['-C', root, 'show', object], {
    maxBuffer: HARD_LIMIT + 1, windowsHide: true,
  }).subarray(0, Math.min(size, HARD_LIMIT));
}

export async function readFile(root: string, value: string, ref?: string, force = false) {
  const safe = resolvePath(root, value, Boolean(ref));
  let size: number;
  let mtime: number | null;
  const sourcePath = safe.absolute;
  let blobObject: string | undefined;

  if (ref) {
    try {
      const commit = gitOutput(safe.root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
      const prefix = gitOutput(safe.root, ['rev-parse', '--show-prefix']);
      blobObject = `${commit}:${prefix}${safe.path}`;
      if (gitOutput(safe.root, ['cat-file', '-t', blobObject]) !== 'blob') throw new Error('not a blob');
      size = Number(gitOutput(safe.root, ['cat-file', '-s', blobObject]));
    } catch { throw new FileError('file.not_found', `File not found at ${ref}: ${safe.path}`); }
    mtime = null;
  } else {
    let stat;
    try { stat = statSync(sourcePath); }
    catch { throw new FileError('file.not_found', `File not found: ${safe.path}`); }
    if (!stat.isFile()) throw new FileError('file.not_found', `Not a regular file: ${safe.path}`);
    size = stat.size;
    mtime = Math.round(stat.mtimeMs);
  }

  const mimeType = mime.getType(safe.path);
  let prefix: Buffer;
  if (blobObject) {
    prefix = await blobPrefix(safe.root, blobObject, 512);
  } else {
    prefix = readLimited(sourcePath, size, 512);
  }
  const binary = isBinaryFileSync(prefix);

  if (binary) {
    if (mimeType?.startsWith('image/') && size <= IMAGE_LIMIT) {
      const data = blobObject ? readBlob(safe.root, blobObject, size) : readLimited(sourcePath, size, IMAGE_LIMIT);
      return { path: safe.path, size, mtime, binary, mime: mimeType, encoding: 'base64' as const, content: data.toString('base64'), tooLarge: false };
    }
    return {
      path: safe.path, size, mtime, binary, mime: mimeType, encoding: null, content: null,
      tooLarge: Boolean(mimeType?.startsWith('image/') && size > IMAGE_LIMIT),
    };
  }

  const limit = force ? HARD_LIMIT : TEXT_LIMIT;
  if (size > limit) return { path: safe.path, size, mtime, binary, mime: mimeType, encoding: 'utf8' as const, content: null, tooLarge: true };
  const data = blobObject ? readBlob(safe.root, blobObject, size) : readLimited(sourcePath, size, limit);
  if (data.length > limit) return { path: safe.path, size, mtime, binary, mime: mimeType, encoding: 'utf8' as const, content: null, tooLarge: true };
  return { path: safe.path, size, mtime, binary, mime: mimeType, encoding: 'utf8' as const, content: data.toString('utf8'), tooLarge: false };
}

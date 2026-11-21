import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyPageOperation, clearPageStart, materializePages, validatePages } from './design-pages.ts';
import { DesignError } from './design-error.ts';
import { applyFrameOperation, normalizeGroups } from './design-frame-ops.ts';
import { applyReviewOperation, finalizeReview, normalizeReview, type ReviewContext } from './design-review.ts';
import { DESIGN_DOCUMENT_BYTES, DESIGN_STORAGE_BYTES, DESIGN_HISTORY_LIMIT, designDocumentSchema, designStorageSchema, designSlugSchema, type DesignDocument, type DesignOperation, type DesignStorage } from '@ormicode/protocol';
import { setDesignToken } from './design-inspector-store.ts';

export { DesignError } from './design-error.ts';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const fail = (message: string): never => { throw new DesignError('design.invalid', message); };

function directory(path: string, create: boolean): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new DesignError('design.outside', 'Design directories must be real directories, not symbolic links');
    return true;
  } catch (error) {
    if (!missing(error)) throw error;
    if (!create) return false;
    mkdirSync(path);
    return true;
  }
}

function boardPath(cwd: string, slug: string, create = false): string {
  if (!designSlugSchema.safeParse(slug).success) throw new DesignError('design.outside', 'Invalid board slug');
  const root = realpathSync(cwd);
  const designs = join(root, 'designs');
  if (!directory(designs, create) || !directory(join(designs, slug), create)) throw new DesignError('design.not_found', slug);
  return join(designs, slug, 'workspace.json');
}

function validateDocument(document: DesignDocument): void {
  if (bytes(document) > DESIGN_DOCUMENT_BYTES) throw new DesignError('design.too_large', 'Current document exceeds 96 KiB');
  if (!designDocumentSchema.safeParse(document).success) fail('Invalid design document');
  validatePages(document);
  const ids = new Set(document.frames.map(frame => frame.id));
  if (ids.size !== document.frames.length || new Set(document.comments.map(comment => comment.id)).size !== document.comments.length) fail('Duplicate frame or comment IDs');
  if (document.workingFrameId !== null && !ids.has(document.workingFrameId)) fail('Working direction does not exist');
  if (document.comments.some(comment => comment.frameId !== null && !ids.has(comment.frameId))) fail('Comment frame does not exist');
}

function read(path: string): DesignStorage {
  let fd: number;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new DesignError('design.outside', 'Board must be a regular file, not a symbolic link');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (missing(error)) throw new DesignError('design.not_found', 'Board not found');
    throw error;
  }
  let data: string;
  try {
    if (!fstatSync(fd).isFile()) fail('Board must be a regular file');
    if (fstatSync(fd).size > DESIGN_STORAGE_BYTES) throw new DesignError('design.too_large', 'Stored board exceeds 224 KiB');
    const buffer = Buffer.alloc(DESIGN_STORAGE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > DESIGN_STORAGE_BYTES) throw new DesignError('design.too_large', 'Stored board exceeds 224 KiB');
    data = buffer.subarray(0, length).toString('utf8');
  } finally { closeSync(fd); }
  let raw: unknown;
  try { raw = JSON.parse(data); } catch { return fail('Board is not valid JSON'); }
  const parsed = designStorageSchema.safeParse(raw);
  if (!parsed.success) return fail('Board has an invalid shape');
  const stored = parsed.data;
  validateDocument(stored.document);
  let previous = 0;
  for (const entry of stored.history) {
    validateDocument(entry.document);
    if (entry.revision !== entry.document.revision || entry.revision <= previous || entry.revision >= stored.document.revision) fail('Invalid revision history');
    previous = entry.revision;
  }
  return stored;
}

function write(path: string, stored: DesignStorage): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(fd, JSON.stringify(stored));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    // Windows transiently locks freshly written files (indexer/AV), so retry
    // the atomic swap a few times before giving up.
    let renamed = false;
    for (let attempt = 0; attempt < 10 && !renamed; attempt++) {
      try { renameSync(temporary, path); renamed = true; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 9) throw error;
        const until = Date.now() + 50; while (Date.now() < until) { /* spin briefly */ }
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (!missing(error)) throw error; }
  }
}

export function designResult(stored: DesignStorage) {
  return { document: normalizeReview(stored.document), history: stored.history.map(({ revision, at, summary }) => ({ revision, at, summary })) };
}

export function getDesign(cwd: string, slug: string): DesignStorage { return read(boardPath(cwd, slug)); }

export function listDesigns(cwd: string) {
  const designs = join(realpathSync(cwd), 'designs');
  if (!directory(designs, false)) return [];
  const boards = [];
  for (const entry of readdirSync(designs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !designSlugSchema.safeParse(entry.name).success) continue;
    let stored: DesignStorage;
    try { stored = getDesign(cwd, entry.name); } catch (error) { if (error instanceof DesignError && error.code === 'design.not_found') continue; throw error; }
    boards.push({ slug: entry.name, name: stored.document.name, revision: stored.document.revision, frames: stored.document.frames.length });
    if (boards.length > 100) throw new DesignError('design.too_large', 'At most 100 boards can be listed');
  }
  return boards;
}

export function createDesign(cwd: string, slug: string, name: string): DesignStorage {
  const path = boardPath(cwd, slug, true);
  try {
    lstatSync(path);
    throw new DesignError('design.conflict', 'Board already exists');
  } catch (error) { if (!missing(error)) throw error; }
  if (listDesigns(cwd).length >= 100) throw new DesignError('design.too_large', 'At most 100 boards are supported per workspace');
  const stored: DesignStorage = { document: { version: 1, name, revision: 1, frames: [], workingFrameId: null, comments: [] }, history: [] };
  validateDocument(stored.document);
  write(path, stored);
  return stored;
}

function apply(document: DesignDocument, operations: DesignOperation[], context: ReviewContext): void {
  const frame = (id: string) => document.frames.find(item => item.id === id) ?? fail(`Frame not found: ${id}`);
  const comment = (id: string) => document.comments.find(item => item.id === id) ?? fail(`Comment not found: ${id}`);
  for (const operation of operations) {
    if (applyPageOperation(document, operation)) { validateDocument(document); continue; }
    if ((operation.type === 'frame.add' && operation.pageId) || (operation.type === 'frame.update' && operation.patch.pageId)) materializePages(document);
    if (applyReviewOperation(document, operation, context)) continue;
    switch (operation.type) {
      case 'frame.add': { const { type: _, ...fields } = operation; document.frames.push({ ...fields, ...(document.pages ? { pageId: fields.pageId ?? document.pages[0]!.id } : {}), id: randomUUID() }); break; }
      case 'frame.update':
        if (operation.patch.pageId && operation.patch.pageId !== frame(operation.frameId).pageId) {
          clearPageStart(document, operation.frameId);
          delete frame(operation.frameId).groupId;
        }
        Object.assign(frame(operation.frameId), operation.patch); break;
      case 'frame.remove':
        clearPageStart(document, operation.frameId);
        frame(operation.frameId);
        document.frames = document.frames.filter(item => item.id !== operation.frameId);
        document.comments = document.comments.filter(item => item.frameId !== operation.frameId);
        if (document.workingFrameId === operation.frameId) document.workingFrameId = null;
        break;
      case 'frame.duplicate': { const { groupId: _, ...original } = frame(operation.frameId); document.frames.push({ ...original, id: randomUUID(), name: `${original.name.slice(0, 110)} copy`, x: Math.min(100000, original.x + 40), y: Math.min(100000, original.y + 40) }); break; }
      case 'direction.select': if (operation.frameId !== null) frame(operation.frameId); document.workingFrameId = operation.frameId; break;
      case 'board.rename': document.name = operation.name; break;
      case 'token.set': setDesignToken(document, operation.token, fail); break;
      case 'comment.remove': comment(operation.commentId); document.comments = document.comments.filter(item => item.id !== operation.commentId); break;
      case 'frames.set': case 'frames.remove': case 'frames.order': case 'frames.stack':
      case 'frames.group': case 'frames.ungroup': case 'frames.paste': case 'frames.restore':
        applyFrameOperation(document, operation, fail, context.history); break;
    }
  }
  normalizeGroups(document);
}

export function updateDesign(cwd: string, slug: string, expectedRevision: number, change: DesignOperation[] | number, context: ReviewContext | string): DesignStorage {
  const path = boardPath(cwd, slug);
  const stored = read(path);
  if (stored.document.revision !== expectedRevision) throw new DesignError('design.conflict', `Expected revision ${expectedRevision}; current revision is ${stored.document.revision}. Reload and reconcile; do not automatically retry.`);
  let document = structuredClone(stored.document);
  if (typeof change === 'number') {
    const entry = stored.history.find(item => item.revision === change);
    if (!entry) throw new DesignError('design.not_found', 'Restore point is no longer retained');
    document = structuredClone(entry.document);
  } else {
    const actorContext = typeof context === 'string' ? { actor: { kind: 'user' as const, session: context }, mentionable: new Set([context]) } : context;
    apply(document, change, { ...actorContext, history: stored.history });
  }
  finalizeReview(stored.document, document, { restore: typeof change === 'number' });
  document.revision = stored.document.revision + 1;
  validateDocument(document);
  const history = [...stored.history, { revision: stored.document.revision, at: Date.now(), summary: typeof change === 'number' ? `Restore revision ${change}` : change.map(item => item.type).join(', ').slice(0, 120), document: stored.document }].slice(-DESIGN_HISTORY_LIMIT);
  const next = { document, history };
  while (bytes(next) > DESIGN_STORAGE_BYTES && history.length > 1) history.shift();
  if (bytes(next) > DESIGN_STORAGE_BYTES) throw new DesignError('design.too_large', 'Document and restore point exceed 224 KiB');
  write(path, next);
  return next;
}

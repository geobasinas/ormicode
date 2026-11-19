import type { Store } from './db.ts';
import type { PromptAttachment, PromptContext } from '@ormicode/protocol';

export interface StoredQueueItem {
  id: string;
  text: string;
  createdAt: number;
  images?: { data: string; mimeType: string; name?: string; size?: number }[];
  context?: PromptContext[];
  attachments?: PromptAttachment[];
  error?: string;
}

interface QueueRow { id: string; text: string; created_at: number; payload: string }

export function listQueuedPrompts(db: Store, session: string): StoredQueueItem[] {
  const rows = db.prepare('SELECT id, text, created_at, payload FROM session_queue WHERE session = ? ORDER BY position, created_at')
    .all(session) as QueueRow[];
  return rows.map(row => ({ id: row.id, text: row.text, createdAt: row.created_at, ...(JSON.parse(row.payload) as Omit<StoredQueueItem, 'id' | 'text' | 'createdAt'>) }));
}

export function addQueuedPrompt(db: Store, session: string, item: StoredQueueItem): void {
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM session_queue WHERE session = ?')
    .get(session) as { next: number }).next;
  const { id, text, createdAt, ...payload } = item;
  db.prepare('INSERT INTO session_queue(id, session, position, text, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, session, position, text, createdAt, JSON.stringify(payload));
}

export function updateQueuedPrompt(db: Store, session: string, id: string, text: string): boolean {
  const row = db.prepare('SELECT payload FROM session_queue WHERE session = ? AND id = ?').get(session, id) as { payload: string } | undefined;
  if (!row) return false;
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  delete payload.error;
  db.prepare('UPDATE session_queue SET text = ?, payload = ? WHERE session = ? AND id = ?')
    .run(text, JSON.stringify(payload), session, id);
  return true;
}

export function setQueuedPromptError(db: Store, session: string, id: string, error: string): boolean {
  const row = db.prepare('SELECT payload FROM session_queue WHERE session = ? AND id = ?').get(session, id) as { payload: string } | undefined;
  if (!row) return false;
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  payload.error = error;
  db.prepare('UPDATE session_queue SET payload = ? WHERE session = ? AND id = ?')
    .run(JSON.stringify(payload), session, id);
  return true;
}

function normalizePositions(db: Store, session: string): void {
  const ids = (db.prepare('SELECT id FROM session_queue WHERE session = ? ORDER BY position, created_at')
    .all(session) as { id: string }[]).map(row => row.id);
  const update = db.prepare('UPDATE session_queue SET position = ? WHERE session = ? AND id = ?');
  db.transaction(() => ids.forEach((id, index) => update.run(index, session, id)))();
}

export function removeQueuedPrompt(db: Store, session: string, id: string): boolean {
  const removed = db.prepare('DELETE FROM session_queue WHERE session = ? AND id = ?').run(session, id).changes === 1;
  if (removed) normalizePositions(db, session);
  return removed;
}

export function moveQueuedPrompt(db: Store, session: string, id: string, index: number): boolean {
  const rows = db.prepare('SELECT id FROM session_queue WHERE session = ? ORDER BY position, created_at')
    .all(session) as { id: string }[];
  const current = rows.findIndex(row => row.id === id);
  if (current < 0) return false;
  const [item] = rows.splice(current, 1);
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, item!);
  const update = db.prepare('UPDATE session_queue SET position = ? WHERE session = ? AND id = ?');
  db.transaction(() => rows.forEach((row, position) => update.run(position, session, row.id)))();
  return true;
}

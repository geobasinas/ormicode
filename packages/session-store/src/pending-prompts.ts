import type { PromptAttachment, PromptContext } from '@ormicode/protocol';
import type { Store } from './db.ts';

export interface PendingPromptData { context?: PromptContext[]; attachments?: PromptAttachment[] }

export function setPendingPromptData(db: Store, session: string, data: PendingPromptData): void {
  db.prepare(`INSERT INTO pending_prompt_data(session, payload) VALUES (?, ?)
    ON CONFLICT(session) DO UPDATE SET payload = excluded.payload`).run(session, JSON.stringify(data));
}

export function getPendingPromptData(db: Store, session: string): PendingPromptData | undefined {
  const row = db.prepare('SELECT payload FROM pending_prompt_data WHERE session = ?').get(session) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) as PendingPromptData : undefined;
}

export function deletePendingPromptData(db: Store, session: string): void {
  db.prepare('DELETE FROM pending_prompt_data WHERE session = ?').run(session);
}

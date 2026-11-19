import type { Store } from './db.ts';

export function getDraft(db: Store, session: string): string {
  return (db.prepare('SELECT text FROM session_drafts WHERE session = ?').get(session) as { text: string } | undefined)?.text ?? '';
}

export function setDraft(db: Store, session: string, text: string): void {
  db.prepare(`INSERT INTO session_drafts(session, text, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(session) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`)
    .run(session, text, Date.now());
}

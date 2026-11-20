import type { Store } from './db.ts';

export function hasPendingApproval(db: Store, session: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM events q
    WHERE q.session = ? AND q.kind = 'approval_request' AND NOT EXISTS (
      SELECT 1 FROM events a WHERE a.session = q.session AND a.seq > q.seq
      AND a.kind IN ('approval_decision', 'interaction_expired')
      AND json_extract(a.payload, '$.request') = json_extract(q.payload, '$.request')) LIMIT 1`).get(session));
}

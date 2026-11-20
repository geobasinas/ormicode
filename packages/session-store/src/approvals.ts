import type { Store } from './db.ts';
import { getSession, type SessionState } from './sessions.ts';

export function hasPendingApproval(db: Store, session: string, options: { includeHandoffs?: boolean } = {}): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM events q
    WHERE q.session = ? AND q.kind = 'approval_request'
    AND (? OR COALESCE(json_extract(q.payload, '$.approvalKind'), '') != 'handoff') AND NOT EXISTS (
      SELECT 1 FROM events a WHERE a.session = q.session AND a.seq > q.seq
      AND a.kind IN ('approval_decision', 'interaction_expired')
      AND json_extract(a.payload, '$.request') = json_extract(q.payload, '$.request')) LIMIT 1`).get(session, options.includeHandoffs === false ? 0 : 1));
}

export function sessionActivityState(db: Store, session: string): SessionState {
  const current = getSession(db, session);
  if (current && current.state !== 'awaiting_approval') return current.state;
  const row = db.prepare(`SELECT CASE kind
      WHEN 'turn_start' THEN 'running' WHEN 'turn_end' THEN 'idle'
      WHEN 'interrupted' THEN 'interrupted' WHEN 'question_request' THEN 'awaiting_input'
      WHEN 'rate_limited' THEN 'retrying' WHEN 'retry_scheduled' THEN 'retrying'
      WHEN 'error' THEN 'paused_rate_limited'
      WHEN 'state' THEN json_extract(payload, '$.state') END AS state
    FROM events WHERE session = ?
      AND kind IN ('turn_start', 'turn_end', 'interrupted', 'question_request', 'rate_limited', 'retry_scheduled', 'error', 'state')
      AND (kind != 'error' OR (json_extract(payload, '$.code') IN ('rate_limited', 'plan_limit')
        AND json_type(payload, '$.resetAt') IN ('integer', 'real')))
      AND (kind != 'state' OR json_extract(payload, '$.state') != 'awaiting_approval')
    ORDER BY seq DESC LIMIT 1`).get(session) as { state: SessionState } | undefined;
  return row?.state ?? 'idle';
}

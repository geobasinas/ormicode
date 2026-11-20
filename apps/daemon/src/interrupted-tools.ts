import type { Store } from '@ormicode/session-store';

export function closeInterruptedTools(db: Store, session: string, record: (session: string, kind: string, payload: Record<string, unknown>) => void): void {
  const calls = db.prepare(`SELECT json_extract(c.payload, '$.callId') AS callId,
      json_extract(c.payload, '$.parent') AS parent FROM events c
    WHERE c.session = ? AND c.kind = 'tool_call'
    AND c.seq > COALESCE((SELECT MAX(seq) FROM events WHERE session = c.session
      AND kind IN ('turn_start', 'turn_end', 'interrupted')), 0) AND NOT EXISTS (
      SELECT 1 FROM events r WHERE r.session = c.session AND r.seq > c.seq AND r.kind = 'tool_result'
      AND json_extract(r.payload, '$.callId') = json_extract(c.payload, '$.callId'))`).all(session) as { callId: string; parent: string | null }[];
  for (const call of calls) record(session, 'tool_result', { callId: call.callId, status: 'interrupted', ...(call.parent ? { parent: call.parent } : {}) });
}

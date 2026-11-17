import { getSession, type Store } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

/**
 * A short recap for when native resume can't reload a session (the agent's
 * transcript is gone or the transport can't load it). Summarises the session
 * row and the last durable events so a fresh agent — or the user — sees what
 * the session was doing. Journaled as a `handoff_brief` event.
 */
export function handoffBrief(db: Store, session: string, tail = 12): string {
  const s = getSession(db, session);
  if (!s) return `session ${session}: no record`;
  const rows = replay(db, session).slice(-tail);
  const lines = rows.map(r => {
    const p = JSON.parse(r.payload) as Record<string, unknown>;
    const detail = p.text ?? p.reason ?? p.message ?? p.name ?? '';
    return `- ${r.kind}${detail ? `: ${String(detail).slice(0, 120)}` : ''}`;
  });
  return [
    `Session ${s.id} (${s.vendor}/${s.transport}, project ${s.project})`,
    `state ${s.state}${s.reason ? ` (${s.reason})` : ''}${s.native_id ? `, native ${s.native_id}` : ''}`,
    ...(lines.length ? ['recent activity:', ...lines] : ['no journaled events']),
  ].join('\n');
}

import { getSession, type Store } from '@ormicode/session-store';
import type { Client } from './dispatch.ts';

const transitions = new WeakMap<Store, Map<string, number>>();

export function handoffTargetError(db: Store, session: string): string | undefined {
  if (getSession(db, session)?.handed_off || handoffInProgress(db, session))
    return 'Session has handed off or is handing off; it no longer accepts work or replies';
}

export function rejectHandoffRequest(db: Store, client: Client, id: string, method: string, body: Record<string, unknown>): boolean {
  if (!['session.prompt', 'session.retry', 'session.resume', 'session.pause'].includes(method)) return false;
  const error = handoffTargetError(db, String(body.session));
  if (!error) return false;
  client.link.replyError(id, 'session.busy', error);
  return true;
}

export function handoffInProgress(db: Store, session: string): boolean {
  return Boolean(transitions.get(db)?.get(session));
}

export function reserveHandoff(db: Store, session: string): () => void {
  let sessions = transitions.get(db);
  if (!sessions) { sessions = new Map(); transitions.set(db, sessions); }
  sessions.set(session, (sessions.get(session) ?? 0) + 1);
  return () => {
    const remaining = sessions.get(session)! - 1;
    if (remaining) sessions.set(session, remaining);
    else sessions.delete(session);
  };
}

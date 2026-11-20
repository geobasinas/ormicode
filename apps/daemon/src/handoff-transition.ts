import type { Store } from '@ormicode/session-store';

const transitions = new WeakMap<Store, Map<string, number>>();

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

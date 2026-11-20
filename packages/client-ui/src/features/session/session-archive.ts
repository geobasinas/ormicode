/** Archive / restore a session and tell every session list in this window to
 * refresh now, instead of waiting for the next idx frame or poll. */
import type { ProtocolTransport } from '@ormicode/client-platform';
import type { SessionSummary } from './useSessions.ts';

export const SESSIONS_CHANGED = 'ormi-sessions-changed';

export function sessionsChanged(): void {
  globalThis.dispatchEvent?.(new Event(SESSIONS_CHANGED));
}

/** Resolves to an error message, or undefined once the daemon confirmed the change. */
export async function setSessionArchived(transport: Pick<ProtocolTransport, 'request'>, session: string, archived: boolean): Promise<string | undefined> {
  let result;
  try { result = await transport.request(archived ? 'session.archive' : 'session.unarchive', { session }); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  if (result.type !== 'res') return String(result.message ?? result.code);
  sessionsChanged();
  return undefined;
}

/** Archived sessions whose title, id, project or branch contains the query. */
export function matchArchived(sessions: SessionSummary[], query = ''): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(s => [s.title, s.id, s.project, s.branch].some(v => v?.toLowerCase().includes(q)));
}

/** Session list hook: session.list plus live refresh on `idx` frames and local archive/restore. */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { SESSIONS_CHANGED } from './session-archive.ts';

export interface SessionSummary { id: string; state: string; project: string; title?: string | null; vendor?: string; transport?: string; updatedAt?: number; branch?: string | null; worktree?: boolean; diff?: { added: number; removed: number; files: number } | null;
  parent?: string | null; team?: string | null; parentless?: boolean; tokens?: number; teamTokens?: number; delegatedApproval?: boolean;
}

export function useSessions({ archived = false }: { archived?: boolean } = {}): { sessions: SessionSummary[]; error?: string } {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      let res;
      try { res = await transport.request('session.list', archived ? { archived } : {}); }
      catch (e) { if (alive) setError(String(e)); return; }
      if (!alive) return;
      if (res.type === 'err') return setError(`${res.code}: ${res.message}`);
      setError(undefined);
      const body = res.body as { sessions?: SessionSummary[]; idx?: SessionSummary[] };
      setSessions(body.sessions ?? body.idx ?? []);
    };
    void refresh();
    const unsubscribe = transport.subscribeEvents(frame => { if (frame.type === 'evt' || frame.type === 'idx') void refresh(); });
    const changed = () => void refresh();
    globalThis.addEventListener?.(SESSIONS_CHANGED, changed);
    const t = setInterval(refresh, 10_000);
    return () => { alive = false; clearInterval(t); unsubscribe(); globalThis.removeEventListener?.(SESSIONS_CHANGED, changed); };
  }, [transport, archived]);
  return { sessions, ...(error !== undefined ? { error } : {}) };
}

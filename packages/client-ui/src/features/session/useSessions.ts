/** Session list hook: session.list plus live refresh on `idx` frames. */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface SessionSummary { id: string; state: string; project: string; title?: string | null; vendor?: string; transport?: string; updatedAt?: number; branch?: string | null }

export function useSessions(): { sessions: SessionSummary[]; error?: string } {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      let res;
      try { res = await transport.request('session.list', {}); }
      catch (e) { if (alive) setError(String(e)); return; }
      if (!alive) return;
      if (res.type === 'err') return setError(`${res.code}: ${res.message}`);
      setError(undefined);
      const body = res.body as { sessions?: SessionSummary[]; idx?: SessionSummary[] };
      setSessions(body.sessions ?? body.idx ?? []);
    };
    void refresh();
    const prev = transport.onEvent;
    transport.onEvent = frame => { prev?.(frame); if (frame.type === 'evt' || frame.type === 'idx') void refresh(); };
    const t = setInterval(refresh, 10_000);
    return () => { alive = false; clearInterval(t); transport.onEvent = prev; };
  }, [transport]);
  return { sessions, ...(error !== undefined ? { error } : {}) };
}

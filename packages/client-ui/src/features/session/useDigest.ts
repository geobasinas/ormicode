import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionSummary } from './useSessions.ts';

const KEY = 'ormi.digest.since';
const DAY = 24 * 60 * 60 * 1000;

export type DigestEntry =
  | { session: string; rank: 'silent'; source: string; silentMs: number }
  | {
    session: string; rank: 'waiting' | 'failed' | 'done' | 'progressed'; source: string;
    changed: { paths: string[]; result?: string };
    wants: { kind: 'approval' | 'question' | 'rate_limit'; since: number } | null;
    dropped: string[]; where: { state: string; ageMs: number }; cost: { tokens: number; usd?: number };
  };

function loadSince(): number {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    const since = value === null || value === undefined ? NaN : Number(value);
    return Number.isFinite(since) ? since : Date.now() - DAY;
  } catch { return Date.now() - DAY; }
}

export function useDigest(sessions: SessionSummary[]): DigestEntry[] {
  const { transport } = usePlatform();
  const [since] = useState(loadSince);
  const [entries, setEntries] = useState<DigestEntry[]>([]);
  const computedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void transport.request('session.digest', { since }).then(res => {
        if (!alive || res.type !== 'res') return;
        const body = res.body as unknown as { computedAt: number; entries: DigestEntry[] };
        computedAt.current = body.computedAt;
        setEntries(body.entries);
      }).catch(() => undefined);
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [transport, sessions, since]);

  useEffect(() => {
    const save = () => {
      if (computedAt.current === undefined) return;
      try { globalThis.localStorage?.setItem(KEY, String(computedAt.current)); } catch { /* private mode */ }
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', save);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  return entries;
}

/** Session details hook: session.get plus live state refresh from events. */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface SessionDetails {
  id: string; title: string | null; state: string; lastSeq?: number; project: string; cwd?: string;
  vendor: string; transport: string; updatedAt: number; branch?: string | null;
  worktree?: boolean;
  scratchFiles?: number;
  model?: string | null; effort?: string | null; mode?: string | null; nativeId?: string | null;
  modes?: { id: string; name: string }[];
  options?: { id: string; category?: string; type?: string; name?: string; current?: string | boolean; choices?: { value: string | boolean; name?: string }[] }[];
  parent?: string | null;
  team?: string | null; parentless?: boolean; tokens?: number;
  teamApprovals?: { session: string; request: string; tool: string; input?: unknown; options: { id: string; label: string }[] }[];
}

export function useSession(session: string | undefined): SessionDetails | undefined {
  const { transport } = usePlatform();
  const [details, setDetails] = useState<SessionDetails>();

  useEffect(() => {
    if (!session) return;
    setDetails(undefined);
    let alive = true;
    const refresh = async () => {
      try {
        const res = await transport.request('session.get', { session });
        if (alive && res.type !== 'err') setDetails(res.body as SessionDetails);
      } catch { /* offline */ }
    };
    void refresh();
    const prev = transport.onEvent;
    transport.onEvent = frame => {
      prev?.(frame);
      if (frame.type === 'idx' || frame.type === 'evt' && frame.session === session) void refresh();
    };
    const timer = setInterval(refresh, 10_000);
    return () => { alive = false; clearInterval(timer); transport.onEvent = prev; };
  }, [transport, session]);
  return details;
}

/** Session details hook: session.get plus live state refresh from events. */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface SessionDetails {
  id: string; title: string | null; state: string; project: string;
  vendor: string; transport: string; updatedAt: number;
  model?: string | null; effort?: string | null; nativeId?: string | null;
  parent?: string | null;
}

export function useSession(session: string | undefined): SessionDetails | undefined {
  const { transport } = usePlatform();
  const [details, setDetails] = useState<SessionDetails>();

  useEffect(() => {
    if (!session) return;
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
      if (frame.type === 'evt' && frame.session === session) void refresh();
    };
    return () => { alive = false; transport.onEvent = prev; };
  }, [transport, session]);
  return details;
}

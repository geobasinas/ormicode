import { useEffect } from 'react';
import type { ProtocolTransport } from '@ormicode/client-platform';
import { designRefresh } from './design-live.ts';

export function useDesignLive(
  transport: ProtocolTransport,
  session: string,
  refresh: (revisions: ReadonlyMap<string, number>) => Promise<void>,
) {
  useEffect(() => {
    const updates = designRefresh(refresh);
    const unsubscribe = transport.subscribeEvents(frame => {
      if (frame.type !== 'evt' || frame.session !== session) return;
      const event = frame.body as Record<string, unknown>;
      if (event.kind === 'design_changed' && typeof event.slug === 'string' && typeof event.revision === 'number') {
        updates.add({ slug: event.slug, revision: event.revision });
      }
    });
    return () => { unsubscribe(); updates.close(); };
  }, [transport, session, refresh]);
}

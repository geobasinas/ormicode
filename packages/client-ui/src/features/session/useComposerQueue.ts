import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProtocolTransport } from '@ormicode/client-platform';

export type QueuedItem = { id: string; text: string; createdAt: number; images?: number; error?: string };

export function useComposerQueue(transport: ProtocolTransport, session: string) {
  const [result, setResult] = useState<{ session: string; items: QueuedItem[] }>();
  const version = useRef(0);
  const refreshQueue = useCallback(async () => {
    const token = ++version.current;
    const response = await transport.request('session.queue.list', { session }).catch(() => undefined);
    if (token === version.current && response?.type === 'res') setResult({ session, items: (response.body as { items: QueuedItem[] }).items });
  }, [transport, session]);
  useEffect(() => {
    void refreshQueue();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = transport.subscribeEvents(frame => {
      if (frame.type === 'evt' && frame.session === session && frame.body.kind === 'queue_changed') {
        ++version.current;
        pending ??= setTimeout(() => { pending = undefined; void refreshQueue(); }, 60);
      }
    });
    const timer = window.setInterval(() => { void refreshQueue(); }, 1200);
    return () => { ++version.current; unsubscribe(); clearTimeout(pending); window.clearInterval(timer); };
  }, [transport, session, refreshQueue]);
  return { queue: result?.session === session ? result.items : [], refreshQueue };
}

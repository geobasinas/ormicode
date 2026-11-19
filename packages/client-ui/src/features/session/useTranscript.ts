/** Transcript hook: subscribe to a session's journal and collect events. */
import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { pendingInteractions } from './pending-interactions.ts';

export interface TranscriptEvent { seq: number; kind: string; body: Record<string, unknown>; ts?: number }

export function useTranscript(session: string | undefined): { events: TranscriptEvent[]; approvals: TranscriptEvent[] } {
  const { transport } = usePlatform();
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const pendingRef = useRef<TranscriptEvent[]>([]);

  useEffect(() => {
    if (!session) return;
    setEvents([]); pendingRef.current = [];
    const prev = transport.onEvent;
    transport.onEvent = frame => {
      prev?.(frame);
      if (frame.type !== 'evt' || frame.session !== session) return;
      const body = frame.body as Record<string, unknown>;
      const evt = { seq: Number(frame.seq ?? 0), kind: String(body.kind), body, ts: Number(frame.ts ?? Date.now()) };
      pendingRef.current = pendingInteractions(pendingRef.current, evt);
      setEvents(es => [...es, evt]);
    };
    transport.subscribe(session);
    return () => { transport.onEvent = prev; transport.unsubscribe(session); };
  }, [transport, session]);
  return { events, approvals: pendingRef.current };
}

/** Transcript hook: subscribe to a session's journal and collect events. */
import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';

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
      if (evt.kind === 'approval_decision' || evt.kind === 'question_answer' || evt.kind === 'interaction_expired')
        pendingRef.current = pendingRef.current.filter(p => p.body.request !== body.request);
      else if (evt.kind === 'approval_request' || evt.kind === 'question_request')
        pendingRef.current = [...pendingRef.current.filter(p => p.body.request !== body.request), evt];
      setEvents(es => [...es, evt]);
    };
    transport.subscribe(session);
    return () => { transport.onEvent = prev; transport.unsubscribe(session); };
  }, [transport, session]);
  return { events, approvals: pendingRef.current };
}

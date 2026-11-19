import { useEffect, useRef, useState } from 'react';
import type { DesignActivityItem } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from '../session/useSession.ts';
import type { DesignAgentContext } from './design-agent-context.ts';

const SESSION_EVENTS = new Set(['state', 'turn_start', 'turn_end', 'approval_request', 'approval_decision', 'question_request',
  'question_answer', 'interaction_expired', 'rate_limited', 'retry_scheduled', 'interrupted', 'error', 'prompt']);

export function useDesignAgent(details: SessionDetails, online: boolean, board?: DesignAgentContext) {
  const { transport } = usePlatform();
  const session = details.id;
  const [live, setLive] = useState<SessionDetails>();
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastError, setLastError] = useState('');
  const lastSeq = useRef(0);
  const [activity, setActivity] = useState<{ slug: string; edits: DesignActivityItem[]; error?: string }>();
  const slug = board?.slug;
  const revision = board?.revision;

  useEffect(() => {
    if (!online) return;
    let alive = true;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const refresh = () => {
      pending = undefined;
      const token = ++generation;
      void transport.request('session.get', { session }).then(response => {
        if (alive && token === generation && response.type === 'res') setLive(response.body as unknown as SessionDetails);
      }).catch(() => undefined);
    };
    const unsubscribe = transport.subscribeEvents(frame => {
      if (frame.type !== 'evt' || frame.session !== session || typeof frame.seq !== 'number' || frame.seq <= lastSeq.current) return;
      const { kind, text, message, reason } = frame.body;
      if (!SESSION_EVENTS.has(kind)) return;
      lastSeq.current = frame.seq;
      if (kind === 'prompt' && typeof text === 'string') setLastPrompt(text.split('\n', 1)[0]!.slice(0, 180));
      if (kind === 'turn_start') setLastError('');
      if (kind === 'error' && typeof message === 'string') setLastError(message.slice(0, 300));
      if ((kind === 'state' || kind === 'interrupted') && typeof reason === 'string') setLastError(reason.slice(0, 300));
      ++generation;
      pending ??= setTimeout(refresh, 60);
    });
    refresh();
    return () => { alive = false; clearTimeout(pending); unsubscribe(); };
  }, [transport, session, online]);

  useEffect(() => {
    if (!slug || !online) return;
    let alive = true;
    const failed = (error: string) => {
      if (alive) setActivity(previous => ({ slug, edits: previous?.slug === slug ? previous.edits : [], error }));
    };
    void transport.request('design.activity', { session, slug }).then(response => {
      if (!alive) return;
      if (response.type === 'err') failed(response.message);
      if (response.type === 'res') setActivity({ slug, edits: (response.body as { edits: DesignActivityItem[] }).edits });
    }).catch(reason => failed(String(reason)));
    return () => { alive = false; };
  }, [transport, session, slug, revision, online]);
  return { details: live && live.updatedAt >= details.updatedAt ? live : details, lastPrompt, lastError, activity: activity?.slug === slug ? activity : undefined };
}

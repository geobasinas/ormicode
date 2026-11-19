import { useEffect, useRef, useState } from 'react';
import type { DesignOperation } from '@ormicode/protocol';
import { usePlatform } from '../../../lib/platform.ts';
import { extractMentions, type CommentTarget, type MentionableSession } from './review-model.ts';

export function useDesignReview(session: string, slug: string, mutate: (operations: DesignOperation[]) => Promise<boolean>) {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<MentionableSession[]>([]);
  const [mentionError, setMentionError] = useState('');
  const [pending, setPending] = useState<CommentTarget | null>(null);
  const [thread, setThread] = useState('');
  const [threadFocus, setThreadFocus] = useState(0);
  const [focus, setFocus] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let stale = false;
    setSessions([]); setMentionError('');
    void transport.request('design.mentionable', { session }).then(response => {
      if (stale) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      setSessions((response.body as { sessions: MentionableSession[] }).sessions);
    }).catch(error => { if (!stale) setMentionError(String(error)); });
    return () => { stale = true; };
  }, [session, transport]);
  useEffect(() => { setPending(null); setThread(''); }, [session, slug]);
  useEffect(() => { if (focus) composer.current?.focus(); }, [focus]);
  const begin = (target: CommentTarget) => { setPending(target); setThread(''); setFocus(value => value + 1); };
  return {
    sessions, mentionError, pending, setPending, thread, threadFocus, composer, focus, begin,
    setThread: (id: string) => { setThread(id); setThreadFocus(value => value + 1); },
    add: async (target: CommentTarget, text: string) => {
      const ok = await mutate([{ type: 'comment.add', ...target, text: text.trim(), mentions: extractMentions(text, sessions) }]);
      if (ok) setPending(null);
      return ok;
    },
    reply: (commentId: string, text: string) => mutate([{ type: 'comment.reply', commentId, text: text.trim(), mentions: extractMentions(text, sessions) }]),
    resolve: (commentId: string, resolved: boolean) => mutate([{ type: 'comment.resolve', commentId, resolved }]),
    remove: (commentId: string) => mutate([{ type: 'comment.remove', commentId }]),
    approve: (frameId: string, status: 'approved' | 'draft') => mutate([{ type: 'frame.approval', frameId, status }]),
    restore: (frameId: string, revision: number) => mutate([{ type: 'frame.restoreVersion', frameId, revision }]),
  };
}
export type DesignReview = ReturnType<typeof useDesignReview>;

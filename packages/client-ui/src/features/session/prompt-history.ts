import type { ProtocolTransport } from '@ormicode/client-platform';

export type PromptHistoryItem = { text: string; createdAt: number };

export function loadPromptHistory(transport: Pick<ProtocolTransport, 'request'>, project: string | undefined, query: string, receive: (items: PromptHistoryItem[]) => void, delay = 180) {
  let active = true;
  const timer = setTimeout(() => {
    void transport.request('prompts.history', { ...(project ? { project } : {}), query, limit: 50 }).then(response => {
      if (active && response.type === 'res') receive((response.body as { items: PromptHistoryItem[] }).items.slice(0, 50));
    }).catch(() => undefined);
  }, delay);
  return () => { active = false; clearTimeout(timer); };
}

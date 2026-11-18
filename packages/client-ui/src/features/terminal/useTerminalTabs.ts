/** Terminal tabs for a session: ids survive pane toggles and reloads
 *  (localStorage), and are dropped once the broker no longer has them. */
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface TermTab { terminal: string; shell: string; exited: boolean }

const key = (session: string) => `ormi.term.${session}`;
const load = (session: string): string[] => { try { return JSON.parse(localStorage.getItem(key(session)) ?? '[]') as string[]; } catch { return []; } };
const save = (session: string, ids: string[]) => localStorage.setItem(key(session), JSON.stringify(ids));
const shellName = (s: string) => s.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? s;

export function useTerminalTabs(session: string) {
  const { transport } = usePlatform();
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    const res = await transport.request('terminal.open', { session, cols: 80, rows: 24 });
    if (res.type === 'err') { setError(String((res as { message?: string }).message ?? res.code)); return; }
    const b = res.body as { terminal: string; shell: string };
    setTabs(ts => { const next = [...ts, { terminal: b.terminal, shell: shellName(b.shell), exited: false }]; save(session, next.map(t => t.terminal)); return next; });
    setActive(b.terminal);
  }, [transport, session]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await transport.request('terminal.list', {});
      if (!alive) return;
      const live = res.type === 'res' ? (res.body as { terminals: { terminal: string; shell: string; exited: boolean }[] }).terminals : [];
      const mine = load(session).map(id => live.find(t => t.terminal === id)).filter((t): t is NonNullable<typeof t> => !!t);
      save(session, mine.map(t => t.terminal));
      if (!mine.length) { await open(); return; }
      setTabs(mine.map(t => ({ terminal: t.terminal, shell: shellName(t.shell), exited: t.exited })));
      setActive(mine[mine.length - 1]!.terminal);
    })();
    return () => { alive = false; };
  }, [transport, session, open]);

  const close = useCallback((terminal: string) => {
    void transport.request('terminal.close', { terminal });
    setTabs(ts => {
      const next = ts.filter(t => t.terminal !== terminal); save(session, next.map(t => t.terminal));
      setActive(a => a === terminal ? next[next.length - 1]?.terminal ?? null : a);
      return next;
    });
  }, [transport, session]);

  const markExited = useCallback((terminal: string) => setTabs(ts => ts.map(t => t.terminal === terminal ? { ...t, exited: true } : t)), []);
  return { tabs, active, setActive, open, close, markExited, error };
}

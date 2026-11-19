import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewConsoleEntry } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { PreviewConsoleCursor } from './preview-console-cursor.ts';

export function usePreviewConsole(session: string) {
  const { transport } = usePlatform();
  const [entries, setEntries] = useState<PreviewConsoleEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [dropped, setDropped] = useState(0);
  const cursor = useRef(new PreviewConsoleCursor());
  const stored = useRef<PreviewConsoleEntry[]>([]);
  const open = useRef(false);
  const clearing = useRef(false);

  useEffect(() => {
    let alive = true;
    cursor.current.reset();
    clearing.current = false;
    stored.current = [];
    setEntries([]); setUnread(0); setDropped(0);
    const poll = async () => {
      if (clearing.current) return;
      const request = cursor.current.beginRequest();
      const after = request.after;
      const response = await transport.request('preview.console', { session, limit: 200, ...(after === undefined ? {} : { after }) }).catch(() => undefined);
      if (!alive || clearing.current || response?.type !== 'res') return;
      const page = response.body as { entries: PreviewConsoleEntry[]; next: number; dropped: number };
      if (!cursor.current.commit(request, page.next)) return;
      const known = new Set(stored.current.map(entry => entry.id));
      const fresh = page.entries.filter(entry => !known.has(entry.id));
      stored.current = [...stored.current, ...fresh].slice(-500);
      setEntries(stored.current);
      if (!open.current) setUnread(value => value + fresh.length);
      setDropped(page.dropped);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [session, transport]);

  const setOpen = useCallback((value: boolean) => {
    open.current = value;
    if (value) setUnread(0);
  }, []);
  const clear = useCallback(async () => {
    cursor.current.reset();
    clearing.current = true;
    try {
      const response = await transport.request('preview.console_clear', { session });
      if (response.type === 'res') {
        stored.current = [];
        setEntries([]); setUnread(0); setDropped(0);
      }
    } finally { clearing.current = false; }
  }, [session, transport]);
  return { entries, unread, dropped, setOpen, clear };
}

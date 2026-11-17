/** Notes hook: session.getNotes/setNotes/deleteNote with debounced save. */
import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface SessionNote { id: string; title: string; body: string; updatedAt: number }

export function useNotes(session: string | undefined) {
  const { transport } = usePlatform();
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void transport.request('session.getNotes', { session }).then(res => {
      if (alive && res.type !== 'err') setNotes((res.body as { notes: SessionNote[] }).notes ?? []);
    }).catch(() => undefined);
    return () => { alive = false; clearTimeout(timer.current); };
  }, [transport, session]);

  const save = (note: Partial<SessionNote> & { body: string }) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void transport.request('session.setNotes', { session, id: note.id, title: note.title ?? 'Untitled', body: note.body })
        .then(res => {
          if (res.type === 'err') return;
          const id = (res.body as { id: string }).id;
          setNotes(ns => {
            const next: SessionNote = { id, title: note.title ?? 'Untitled', body: note.body, updatedAt: Date.now() };
            const i = ns.findIndex(n => n.id === id);
            return i >= 0 ? ns.map((n, j) => j === i ? next : n) : [...ns, next];
          });
        }).catch(() => undefined);
    }, 400);
    return timer;
  };

  const remove = (id: string) => {
    setNotes(ns => ns.filter(n => n.id !== id));
    void transport.request('session.deleteNote', { session, id }).catch(() => undefined);
  };

  return { notes, save, remove };
}

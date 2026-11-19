import { useEffect, useRef, useState, type ReactNode } from 'react';

export function TranscriptScroller({ count, children }: { count: number; children: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const previous = useRef(count);
  const [following, setFollowing] = useState(true);
  const [newEvents, setNewEvents] = useState(0);
  useEffect(() => {
    const delta = Math.max(0, count - previous.current);
    previous.current = count;
    if (following) { end.current?.scrollIntoView({ block: 'end' }); setNewEvents(0); }
    else if (delta) setNewEvents(value => value + delta);
  }, [count, following]);
  const onScroll = () => {
    const el = scroll.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 36) {
      setFollowing(true);
      setNewEvents(0);
    } else setFollowing(false);
  };
  return <div ref={scroll} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', justifyContent: 'center', position: 'relative' }}>
    <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-4) var(--space-5)' }}>
      {children}
      <div ref={end} />
    </div>
    {!following ? <button type="button" onClick={() => { setFollowing(true); setNewEvents(0); end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }} style={{
      position: 'absolute', bottom: 12, right: 20, border: '1px solid var(--line-card)',
      borderRadius: 16, padding: '6px 10px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
      font: 'inherit', fontSize: 11, boxShadow: 'var(--shadow-md)', cursor: 'pointer',
    }}>Jump to latest{newEvents ? ` · ${newEvents} new` : ''}</button> : null}
  </div>;
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { saveTranscriptPosition, transcriptPosition } from './transcript-position.ts';

export function TranscriptScroller({ count, children, session, header }: { count: number; children: ReactNode; session: string; header?: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const previous = useRef(count);
  const saved = useRef(transcriptPosition(session));
  const restored = useRef(!saved.current);
  const followingRef = useRef(saved.current?.following ?? !header);
  const [following, setFollowing] = useState(followingRef.current);
  const [newEvents, setNewEvents] = useState(0);
  useLayoutEffect(() => {
    const el = scroll.current;
    return () => { if (el && restored.current) saveTranscriptPosition(session, el.scrollTop, followingRef.current); };
  }, [session]);
  useEffect(() => {
    if (restored.current || !count) return;
    const timer = window.setTimeout(() => {
      restored.current = true;
      if (scroll.current) scroll.current.scrollTop = saved.current!.top;
      if (saved.current?.following) end.current?.scrollIntoView({ block: 'end' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [count]);
  useEffect(() => {
    if (!restored.current) { previous.current = count; return; }
    const delta = Math.max(0, count - previous.current);
    previous.current = count;
    const el = scroll.current;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    if (followingRef.current || !header && atBottom) {
      followingRef.current = true;
      setFollowing(true);
      setNewEvents(0);
      end.current?.scrollIntoView({ block: 'end' });
    } else {
      followingRef.current = false;
      setFollowing(false);
      if (delta) setNewEvents(value => value + delta);
    }
  }, [count]);
  const onScroll = () => {
    if (!restored.current) return;
    const el = scroll.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 80) {
      followingRef.current = true;
      setFollowing(true);
      setNewEvents(0);
    } else {
      followingRef.current = false;
      setFollowing(false);
    }
  };
  return <div ref={scroll} className="ormi-transcript-scroller" onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', justifyContent: 'center', position: 'relative' }}>
    <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-4) var(--space-5)' }}>
      {header}
      {children}
      <div ref={end} />
    </div>
    {!following ? <button type="button" onClick={() => { followingRef.current = true; setFollowing(true); setNewEvents(0); end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }} style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', border: '1px solid var(--line-card)',
      borderRadius: 16, padding: '6px 10px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
      font: 'inherit', fontSize: 11, boxShadow: 'var(--shadow-md)', cursor: 'pointer',
    }}>Jump to latest{newEvents ? ` · ${newEvents} new` : ''}</button> : null}
  </div>;
}

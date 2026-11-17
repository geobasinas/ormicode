/** Transcript view: renders journaled event kinds in order. */
import { useEffect, useRef } from 'react';
import type { TranscriptEvent } from './useTranscript.ts';

const mono = { fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' as const };

function line(e: TranscriptEvent) {
  const b = e.body;
  switch (e.kind) {
    case 'text': return <div style={{ color: 'var(--text-active)', padding: '2px 0' }}>{String(b.text)}</div>;
    case 'thinking': return <div style={{ ...mono, color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>{String(b.text)}</div>;
    case 'tool_call': return <div style={{ ...mono, color: 'var(--accent-amber)', fontSize: 'var(--text-sm)' }}>▸ {String(b.name)} {JSON.stringify(b.input ?? '')}</div>;
    case 'tool_result': return <div style={{ ...mono, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>◂ {String(b.output ?? b.text ?? '').slice(0, 400)}</div>;
    case 'error': return <div style={{ color: 'var(--accent-red)' }}>✗ {String(b.message ?? b.code)}</div>;
    case 'turn_start': return <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-xs)', marginTop: 8 }}>— turn —</div>;
    case 'turn_end': return <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-xs)' }}>— done —</div>;
    case 'handoff_brief': return <div style={{ ...mono, color: 'var(--accent-mint)', fontSize: 'var(--text-sm)' }}>⇢ handoff brief</div>;
    case 'resumed': return <div style={{ color: 'var(--accent-mint)', fontSize: 'var(--text-sm)' }}>↻ resumed</div>;
    case 'interrupted': return <div style={{ color: 'var(--accent-amber)', fontSize: 'var(--text-sm)' }}>⏸ interrupted{typeof b.reason === 'string' ? ` — ${b.reason}` : ''}</div>;
    default: return null;
  }
}

export function Transcript({ events }: { events: TranscriptEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-3)' }}>
      {events.map(e => <div key={e.seq}>{line(e)}</div>)}
      <div ref={end} />
    </div>
  );
}

/** Transcript view: prompts as right-aligned bubbles, assistant text left,
 * tool calls as compact action cards, system events as muted lines. */
import { useEffect, useRef } from 'react';
import { Pencil, Wrench, CircleAlert, ArrowRight, RotateCw, Pause, ChevronRight } from 'lucide-react';
import type { TranscriptEvent } from './useTranscript.ts';

const mono = { fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const };
const small = { fontSize: 'var(--text-sm)' };

function toolCard(icon: React.ReactNode, label: string, detail?: string) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '4px 0',
      padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-card)',
      border: '1px solid var(--line-card)', borderRadius: 'var(--radius-sm)',
      color: 'var(--text-secondary)', fontSize: 'var(--text-sm)',
    }}>
      {icon}
      <span style={{ color: 'var(--text-active)', fontWeight: 500 }}>{label}</span>
      {detail ? <span style={{ ...mono, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span> : null}
    </div>
  );
}

function inputSummary(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const file = o.file_path ?? o.filePath ?? o.path ?? o.command;
    if (typeof file === 'string') return file;
  }
  const s = JSON.stringify(input);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write']);

function line(e: TranscriptEvent) {
  const b = e.body;
  switch (e.kind) {
    case 'prompt':
      return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
          <div style={{
            maxWidth: '78%', padding: '8px 12px', background: 'var(--bg-raised)',
            border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
            color: 'var(--text-active)', fontSize: 'var(--text-md)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{String(b.text)}</div>
        </div>
      );
    case 'text':
      return <div style={{ color: 'var(--text-label)', fontSize: 'var(--text-md)', lineHeight: 1.55, padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(b.text)}</div>;
    case 'thinking':
      return <div style={{ ...mono, ...small, color: 'var(--text-hint)' }}>{String(b.text)}</div>;
    case 'plan':
      return <div style={{ ...mono, ...small, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{String(b.text)}</div>;
    case 'tool_call': {
      const name = String(b.name);
      const detail = inputSummary(b.input);
      const isEdit = EDIT_TOOLS.has(name);
      return toolCard(
        isEdit ? <Pencil size={13} style={{ color: 'var(--accent-mint)', flexShrink: 0 }} /> : <Wrench size={13} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />,
        isEdit ? `Edited ${detail.split(/[\\/]/).pop() ?? detail}` : name,
        isEdit ? undefined : detail,
      );
    }
    case 'tool_result':
      return <div style={{ ...mono, ...small, color: 'var(--text-hint)', padding: '0 0 0 22px' }}>{String(b.output ?? b.text ?? '').slice(0, 400)}</div>;
    case 'error':
      return toolCard(<CircleAlert size={13} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />, 'error', String(b.message ?? b.code));
    case 'turn_start':
      return <div style={{ borderTop: '1px solid var(--line-pane)', margin: '14px 0 8px' }} />;
    case 'turn_end':
      return null;
    case 'handoff_brief':
      return toolCard(<ArrowRight size={13} style={{ color: 'var(--accent-mint)', flexShrink: 0 }} />, 'handoff brief', String(b.text ?? ''));
    case 'resumed':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-mint)', ...small }}><RotateCw size={12} /> resumed</div>;
    case 'interrupted':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-amber)', ...small }}><Pause size={12} /> interrupted{typeof b.reason === 'string' ? ` — ${b.reason}` : ''}</div>;
    case 'state':
      return null;
    case 'agent_version':
    case 'usage':
    case 'evicted':
      return null;
    default:
      return <div style={{ ...mono, ...small, color: 'var(--text-hint)', display: 'flex', gap: 6, alignItems: 'center' }}><ChevronRight size={11} />{e.kind}</div>;
  }
}

export function Transcript({ events }: { events: TranscriptEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-4) var(--space-5)' }}>
        {events.map(e => <div key={e.seq}>{line(e)}</div>)}
        <div ref={end} />
      </div>
    </div>
  );
}

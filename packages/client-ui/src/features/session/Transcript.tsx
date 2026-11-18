/** Transcript view: prompts as right-aligned bubbles, assistant text left,
 * tool calls as compact expandable rows (result folded in, checkpoint as a
 * hover-only icon), system events as muted lines. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, CircleAlert, ArrowRight, RotateCw, Pause, ChevronRight, History, CircleCheck, MessageCircle, Clock3 } from 'lucide-react';
import { ToolRow, ThinkingRow, CheckpointMark } from './ToolRow.tsx';
import type { TranscriptEvent } from './useTranscript.ts';

const mono = { fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const };
const small = { fontSize: 12 };

function toolCard(icon: React.ReactNode, label: string, detail?: string) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '4px 0',
      padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-card)',
      border: '1px solid var(--line-card)', borderRadius: 'var(--radius-sm)',
      color: 'var(--text-secondary)', fontSize: 12,
    }}>
      {icon}
      <span style={{ color: 'var(--text-active)', fontWeight: 500 }}>{label}</span>
      {detail ? <span style={{ ...mono, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span> : null}
    </div>
  );
}

function eventLine(icon: React.ReactNode, text: string) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-hint)', fontSize: 12, lineHeight: '18px' }}>{icon}{text}</div>;
}

interface Ctx { session: string; results: Map<string, TranscriptEvent>; cpAfter: Map<number, TranscriptEvent>; calls: Set<string>; attached: Set<number> }

function line(e: TranscriptEvent, ctx: Ctx) {
  const b = e.body;
  switch (e.kind) {
    case 'prompt':
      return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
          <div style={{
            maxWidth: '78%', padding: '8px 12px', background: 'var(--bg-raised)',
            border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
            color: 'var(--text-active)', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{String(b.text)}</div>
        </div>
      );
    case 'text':
      return <div style={{ color: 'var(--text-label)', fontSize: 14, lineHeight: 1.55, padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(b.text)}</div>;
    case 'thinking':
      return <ThinkingRow text={String(b.text)} />;
    case 'plan':
      return <div style={{ ...mono, ...small, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{String(b.text)}</div>;
    case 'tool_call': {
      const result = ctx.results.get(String(b.callId));
      return <ToolRow call={e} result={result} checkpoint={result ? ctx.cpAfter.get(result.seq) : undefined} session={ctx.session} />;
    }
    case 'tool_result':
      if (ctx.calls.has(String(b.callId))) return null;
      return <div style={{ ...mono, ...small, color: 'var(--text-hint)', padding: '0 0 0 22px' }}>{String(b.output ?? b.text ?? '').slice(0, 400)}</div>;
    case 'error':
      return toolCard(<CircleAlert size={13} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />, 'error', String(b.message ?? b.code));
    case 'turn_start':
      return <div style={{ height: 18 }} />;
    case 'turn_end':
      return null;
    case 'workspace_step':
      return null;
    case 'handoff_brief':
      return toolCard(<ArrowRight size={13} style={{ color: 'var(--accent-mint)', flexShrink: 0 }} />, 'handoff brief', String(b.text ?? ''));
    case 'resumed':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-mint)', ...small }}><RotateCw size={12} /> resumed</div>;
    case 'interrupted':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-amber)', ...small }}><Pause size={12} /> interrupted{typeof b.reason === 'string' ? ` — ${b.reason}` : ''}</div>;
    case 'checkpoint':
      if (ctx.attached.has(e.seq)) return null;
      return <div className="ormi-hover-zone" style={{ position: 'relative', height: 14 }}>
        <span style={{ position: 'absolute', right: -26, top: -4, width: 22, display: 'inline-flex', justifyContent: 'center' }}><CheckpointMark session={ctx.session} cp={e} /></span>
      </div>;
    case 'checkpoint_restored':
      return <div style={{ ...small, color: 'var(--text-hint)', display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }} title={String(b.id ?? '')}>
        <History size={11} />Restored files to checkpoint <span style={mono}>{String(b.id ?? '').slice(0, 7)}</span>
      </div>;
    case 'approval_request':
    case 'question_request':
      return null;
    case 'approval_decision':
      return eventLine(<CircleCheck size={12} />, b.option === 'deny' ? 'Denied' : 'Allowed');
    case 'question_answer':
      return eventLine(<MessageCircle size={12} />, 'Answered');
    case 'interaction_expired':
      return eventLine(<Clock3 size={12} />, 'Request expired');
    case 'file_edit':
      return eventLine(<Pencil size={12} />, `Edited ${String(b.path ?? 'a file')} by hand`);
    case 'terminal_open':
    case 'terminal_close':
      return null;
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

function WorkspaceStepsRow({ steps }: { steps: TranscriptEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const warning = steps.some(step => step.body.status === 'warn');
  const create = steps.find(step => step.body.step === 'create');
  const detail = String(create?.body.detail ?? '');
  const match = detail.match(/^created (.+) from (.+)$/);
  const summary = match ? <>Prepared worktree <span style={mono}>{match[1]}</span> from <span style={mono}>{match[2]}</span></> : 'Prepared worktree';
  const labels: Record<string, string> = { fetch: 'Fetch', create: 'Create', copy_dirty: 'Copy uncommitted changes', include: 'Include ignored files', setup: 'Setup' };
  return (
    <div style={{ margin: '4px 0', color: 'var(--text-hint)', fontSize: 12 }}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="hv-sub" style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, background: 'transparent',
        color: 'var(--text-hint)', font: 'inherit', fontSize: 12, padding: '2px 0', cursor: 'pointer',
      }}>
        <ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }} />
        {warning ? <span style={{ color: 'var(--accent-amber)' }}>⚠</span> : null}
        <span>{summary}</span>
      </button>
      {expanded ? <div style={{ margin: '3px 0 2px 17px', paddingLeft: 8, borderLeft: '1px solid var(--line-card)' }}>
        {steps.map(step => (
          <div key={step.seq} style={{ margin: '4px 0', fontSize: 11 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: step.body.status === 'warn' ? 'var(--accent-amber)' : 'var(--text-label)' }}>{labels[String(step.body.step)] ?? String(step.body.step)}</span>
              <span>{String(step.body.status)}</span>
              {typeof step.body.detail === 'string' ? <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{step.body.detail}</span> : null}
            </div>
            {typeof step.body.output === 'string' && step.body.output ? <pre style={{
              ...mono, maxHeight: 240, overflow: 'auto', margin: '4px 0', padding: 7,
              background: 'var(--bg-main)', border: '1px solid var(--line-card)', borderRadius: 5, fontSize: 10,
            }}>{step.body.output}</pre> : null}
          </div>
        ))}
      </div> : null}
    </div>
  );
}

export function Transcript({ events, session }: { events: TranscriptEvent[]; session: string }) {
  const end = useRef<HTMLDivElement>(null);
  const ctx = useMemo<Ctx>(() => {
    const results = new Map<string, TranscriptEvent>(); const calls = new Set<string>(); const cpAfter = new Map<number, TranscriptEvent>(); const attached = new Set<number>();
    for (const e of events) {
      if (e.kind === 'tool_call') calls.add(String(e.body.callId));
      else if (e.kind === 'tool_result') results.set(String(e.body.callId), e);
    }
    const resultSeqs = new Set([...results.values()].filter(r => calls.has(String(r.body.callId))).map(r => r.seq));
    for (const e of events) if (e.kind === 'checkpoint' && resultSeqs.has(Number(e.body.seq))) { cpAfter.set(Number(e.body.seq), e); attached.add(e.seq); }
    return { session, results, calls, cpAfter, attached };
  }, [events, session]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-4) var(--space-5)' }}>
        {events.map((e, i) => e.kind === 'workspace_step'
          ? i === events.findIndex(event => event.kind === 'workspace_step')
            ? <WorkspaceStepsRow key={e.seq > 0 ? e.seq : -i - 1} steps={events.filter(event => event.kind === 'workspace_step')} />
            : null
          : <div key={e.seq > 0 ? e.seq : -i - 1}>{line(e, ctx)}</div>)}
        <div ref={end} />
      </div>
    </div>
  );
}

/** Transcript view: prompts as right-aligned bubbles, assistant text left,
 * tool calls as compact expandable rows (result folded in, checkpoint as a
 * hover-only icon), system events as muted lines. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, CircleAlert, ArrowRight, RotateCw, Pause, ChevronRight, History, CircleCheck, MessageCircle, Clock3, Search, Cpu, Gauge } from 'lucide-react';
import { ToolRow, ThinkingRow, CheckpointMark } from './ToolRow.tsx';
import type { TranscriptEvent } from './useTranscript.ts';
import { Markdown } from './Markdown.tsx';

const mono = { fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const };
const small = { fontSize: 12 };

function eventLine(icon: ReactNode, text: string, color = 'var(--text-hint)') {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 12, lineHeight: '18px' }}>{icon}{text}</div>;
}

interface Ctx {
  session: string; results: Map<string, TranscriptEvent>; cpAfter: Map<number, TranscriptEvent>;
  calls: Set<string>; attached: Set<number>; children: Map<string, TranscriptEvent[]>;
}

const parentOf = (event: TranscriptEvent) => typeof event.body.parent === 'string' ? event.body.parent : undefined;
const keyOf = (event: TranscriptEvent, index: number) => event.seq > 0 ? event.seq : `${event.kind}-${index}`;

function toolRow(event: TranscriptEvent, ctx: Ctx) {
  const callId = String(event.body.callId);
  const children = ctx.children.get(callId) ?? [];
  const nested = renderEvents(children, ctx, true);
  const childRunning = children.some(child =>
    child.kind === 'tool_call' && !ctx.results.has(String(child.body.callId)));
  const childCount = children.filter(child =>
    child.kind === 'tool_call' || child.kind === 'text' || child.kind === 'thinking' || child.kind === 'plan').length
    + children.filter((child, index) =>
      (child.kind === 'text_delta' || child.kind === 'thinking_delta')
      && (index === 0 || children[index - 1]?.kind !== child.kind)).length;
  return <ToolRow
    call={event} result={ctx.results.get(callId)}
    checkpoint={ctx.results.has(callId) ? ctx.cpAfter.get(ctx.results.get(callId)!.seq) : undefined}
    session={ctx.session} childCount={childCount} childRunning={childRunning} nested={nested.length ? nested : undefined}
  />;
}

function hasMergedAfter(events: TranscriptEvent[], index: number, event: TranscriptEvent) {
  const mergedKind = event.kind === 'text_delta' ? 'text' : 'thinking';
  const parent = parentOf(event);
  for (let i = index + 1; i < events.length; i++) {
    const next = events[i]!;
    if (next.kind === 'turn_start' || next.kind === 'turn_end') break;
    if (next.kind === mergedKind && parentOf(next) === parent) return true;
  }
  return false;
}

function line(e: TranscriptEvent, ctx: Ctx): ReactNode {
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
    case 'text_delta':
      return <div style={{ padding: '2px 0' }}><Markdown text={String(b.text)} /></div>;
    case 'thinking':
    case 'thinking_delta':
      return <ThinkingRow text={String(b.text)} />;
    case 'plan':
      return <div style={{ ...mono, ...small, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{String(b.text)}</div>;
    case 'tool_call':
      return toolRow(e, ctx);
    case 'tool_result':
      return null;
    case 'error':
      return <ErrorRow message={String(b.message ?? b.code)} />;
    case 'turn_start':
    case 'turn_end':
      return null;
    case 'workspace_step':
      return null;
    case 'handoff_brief':
      return <HandoffRow text={String(b.text ?? '')} />;
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
    case 'model_changed':
      return eventLine(<Cpu size={12} />, `Switched model to ${String(b.model)}`);
    case 'effort_changed':
      return eventLine(<Gauge size={12} />, `Effort set to ${String(b.effort)}`);
    case 'mode_changed':
      return eventLine(<RotateCw size={12} />, `Mode set to ${String(b.mode)}`);
    case 'compacted':
      return eventLine(null, 'Context compacted');
    case 'lease_conflict':
    case 'lease_drift': {
      const path = String(b.path ?? b.cwd ?? b.workspace ?? '');
      return eventLine(<CircleAlert size={12} />, `${e.kind === 'lease_conflict' ? 'Workspace lease conflict' : 'Workspace lease drift'}${path ? ` · ${path}` : ''}`, 'var(--accent-amber)');
    }
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
    default:
      return null;
  }
}

function ErrorRow({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = message.replace(/\s+/g, ' ').trim();
  return <div style={{ margin: '2px 0', fontSize: 12, lineHeight: '18px', color: 'var(--accent-red)' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} style={{
      display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0,
      border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer',
    }}>
      <CircleAlert size={12} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>
      {expanded ? <ChevronDownSmall /> : <ChevronRight size={11} />}
    </button>
    {expanded ? <div style={{ margin: '3px 0 4px 18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</div> : null}
  </div>;
}

function ChevronDownSmall() {
  return <ChevronRight size={11} style={{ transform: 'rotate(90deg)' }} />;
}

function HandoffRow({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return <div style={{ margin: '3px 0' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, border: 0,
      background: 'transparent', color: 'var(--text-hint)', fontSize: 12, cursor: 'pointer',
    }}><ArrowRight size={12} />Handoff brief <ChevronRight size={11} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} /></button>
    {expanded ? <div style={{ margin: '4px 0 5px 18px' }}><Markdown text={text} /></div> : null}
  </div>;
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

const readTools = new Set(['read', 'view', 'readfile', 'ls', 'webfetch']);
const searchTools = new Set(['grep', 'glob', 'search', 'websearch']);

function explorerKind(event: TranscriptEvent, ctx: Ctx): 'file' | 'search' | undefined {
  if (event.kind !== 'tool_call' || ctx.results.get(String(event.body.callId))?.body.status !== 'completed') return undefined;
  const name = String(event.body.name).toLowerCase().split('__').pop()?.replace(/[_-]+/g, '') ?? '';
  if (readTools.has(name)) return 'file';
  if (searchTools.has(name)) return 'search';
  return undefined;
}

function ExploreRow({ members, files, searches, ctx }: {
  members: TranscriptEvent[]; files: number; searches: number; ctx: Ctx;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = `Explored ${files} ${files === 1 ? 'file' : 'files'}${searches ? `, ${searches} ${searches === 1 ? 'search' : 'searches'}` : ''}`;
  return <div style={{ margin: '2px 0' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="ormi-tool-line" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 0',
      border: 0, background: 'transparent', color: 'var(--text-hint)', fontSize: 12, cursor: 'pointer',
    }}>
      <Search size={12} />{summary}
      {expanded ? <ChevronDownSmall /> : <ChevronRight size={11} className="ormi-hover-reveal" />}
    </button>
    {expanded ? <div style={{ margin: '3px 0 3px 18px', paddingLeft: 9, borderLeft: '1px solid var(--line-card)' }}>
      {members.map((event, index) => <div key={keyOf(event, index)}>{line(event, ctx)}</div>)}
    </div> : null}
  </div>;
}

function retryLine(events: TranscriptEvent[], start: number, key: string | number) {
  let delay: number | undefined;
  let end = start;
  while (end < events.length && ['rate_limited', 'retry_scheduled'].includes(events[end]!.kind)) {
    const event = events[end]!;
    if (event.kind === 'retry_scheduled') delay = Number(event.body.delayMs) || 0;
    end++;
  }
  const seconds = Math.ceil((delay ?? 0) / 1000);
  return {
    end,
    row: <div key={key}>{eventLine(<CircleAlert size={12} />, `Rate limited — retrying in ${seconds}s`, 'var(--accent-amber)')}</div>,
  };
}

function durationLabel(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `Worked for ${minutes}m ${seconds % 60}s` : `Worked for ${seconds}s`;
}

function renderEvents(events: TranscriptEvent[], ctx: Ctx, includeChildren = false): ReactNode[] {
  const rows: ReactNode[] = [];
  let turnStart: number | undefined;
  let turnHadTool = false;
  let workspaceShown = false;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (!includeChildren && parentOf(event)) continue;
    if (event.kind === 'turn_start') {
      turnStart = event.ts;
      turnHadTool = false;
      continue;
    }
    if (event.kind === 'tool_call' && turnStart !== undefined) turnHadTool = true;
    if (event.kind === 'turn_end') {
      if (turnStart !== undefined && turnHadTool && event.ts !== undefined) {
        rows.push(<div key={keyOf(event, i)}>{eventLine(null, durationLabel(turnStart, event.ts))}</div>);
      }
      turnStart = undefined;
      turnHadTool = false;
      continue;
    }
    if (event.kind === 'workspace_step') {
      if (!workspaceShown) {
        rows.push(<WorkspaceStepsRow key={keyOf(event, i)} steps={events.filter(item => item.kind === 'workspace_step')} />);
        workspaceShown = true;
      }
      continue;
    }
    if (event.kind === 'tool_result' || (event.kind === 'checkpoint' && ctx.attached.has(event.seq))) continue;
    if (event.kind === 'rate_limited' || event.kind === 'retry_scheduled') {
      const retry = retryLine(events, i, keyOf(event, i));
      rows.push(retry.row);
      i = retry.end - 1;
      continue;
    }
    if (event.kind === 'text_delta' || event.kind === 'thinking_delta') {
      if (hasMergedAfter(events, i, event)) continue;
      let end = i;
      let text = '';
      while (end < events.length && events[end]!.kind === event.kind && parentOf(events[end]!) === parentOf(event)) {
        text += String(events[end]!.body.text ?? '');
        end++;
      }
      rows.push(<div key={keyOf(event, i)}>{line({ ...event, body: { ...event.body, text } }, ctx)}</div>);
      i = end - 1;
      continue;
    }
    if (explorerKind(event, ctx) && (includeChildren || !parentOf(event))) {
      let end = i;
      const members: TranscriptEvent[] = [];
      let files = 0;
      let searches = 0;
      while (end < events.length) {
        const candidate = events[end]!;
        if (candidate.kind === 'thinking' || candidate.kind === 'thinking_delta') {
          members.push(candidate);
          end++;
          continue;
        }
        if (candidate.kind === 'tool_result' && ctx.calls.has(String(candidate.body.callId))) { end++; continue; }
        if (candidate.kind === 'checkpoint' && ctx.attached.has(candidate.seq)) { end++; continue; }
        if (explorerKind(candidate, ctx) && (includeChildren || !parentOf(candidate))) {
          members.push(candidate);
          if (explorerKind(candidate, ctx) === 'file') files++;
          else searches++;
          end++;
          continue;
        }
        break;
      }
      if (files + searches >= 2) {
        rows.push(<ExploreRow key={keyOf(event, i)} members={members} files={files} searches={searches} ctx={ctx} />);
        i = end - 1;
        continue;
      }
    }
    const node = line(event, ctx);
    if (node !== null && node !== undefined) rows.push(<div key={keyOf(event, i)}>{node}</div>);
  }
  return rows;
}

export function Transcript({ events, session }: { events: TranscriptEvent[]; session: string }) {
  const end = useRef<HTMLDivElement>(null);
  const ctx = useMemo<Ctx>(() => {
    const results = new Map<string, TranscriptEvent>(); const calls = new Set<string>(); const cpAfter = new Map<number, TranscriptEvent>(); const attached = new Set<number>();
    const children = new Map<string, TranscriptEvent[]>();
    for (const e of events) {
      if (e.kind === 'tool_call') calls.add(String(e.body.callId));
      else if (e.kind === 'tool_result') results.set(String(e.body.callId), e);
      const parent = parentOf(e);
      if (parent) children.set(parent, [...(children.get(parent) ?? []), e]);
    }
    const resultSeqs = new Set([...results.values()].filter(r => calls.has(String(r.body.callId))).map(r => r.seq));
    for (const e of events) if (e.kind === 'checkpoint' && resultSeqs.has(Number(e.body.seq))) { cpAfter.set(Number(e.body.seq), e); attached.add(e.seq); }
    return { session, results, calls, cpAfter, attached, children };
  }, [events, session]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-4) var(--space-5)' }}>
        {renderEvents(events, ctx)}
        <div ref={end} />
      </div>
    </div>
  );
}

/** Transcript view: prompts as right-aligned bubbles, assistant text left,
 * tool calls as compact expandable rows (result folded in, checkpoint as a
 * hover-only icon), system events as muted lines. */
import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, CircleAlert, RotateCw, Pause, ChevronRight, History, CircleCheck, MessageCircle, Clock3, Search, Cpu, Gauge } from 'lucide-react';
import { ToolRow, ThinkingRow, CheckpointMark } from './ToolRow.tsx';
import type { TranscriptEvent } from './useTranscript.ts';
import { checkpointPreview, checkpointScreenshots, type CheckpointScreenshotChoice } from './checkpoint-preview.ts';
import { Markdown } from './Markdown.tsx';
import { TranscriptScroller } from './TranscriptScroller.tsx';
import { ChangedFilesCard } from './ChangedFilesCard.tsx';
import { AgentActions, PromptActions } from './MessageActions.tsx';
import { ErrorRow, HandoffRow } from './TranscriptRows.tsx';
import { contextChipLabel } from './composer-parts.tsx';
import type { PromptContext } from '@ormicode/protocol';
import { BrowserActionRow } from './BrowserActionRow.tsx';
import { UiCheckRow } from './UiCheckRow.tsx';
import { TranscriptContextDetails } from './TranscriptContextDetails.tsx';

const mono = { fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const };
const small = { fontSize: 12 };

function eventLine(icon: ReactNode, text: string, color = 'var(--text-hint)') {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 12, lineHeight: '18px' }}>{icon}{text}</div>;
}

interface Ctx {
  session: string; results: Map<string, TranscriptEvent>; cpAfter: Map<number, TranscriptEvent>;
  calls: Set<string>; attached: Set<number>; children: Map<string, TranscriptEvent[]>;
  hiddenCount: number; showHidden: boolean; toggleHidden(): void; events: TranscriptEvent[]; screenshots: CheckpointScreenshotChoice[]; scratch: boolean;
  onHandoff?: () => void; onOpenSession?: (session: string) => void; onEditPrompt?: (text: string) => void; busy?: boolean;
}

const nestedKinds = new Set(['tool_call', 'tool_result', 'text', 'text_delta', 'thinking', 'thinking_delta', 'plan']);
const parentOf = (event: TranscriptEvent) => nestedKinds.has(event.kind) && typeof event.body.parent === 'string' ? event.body.parent : undefined;
const keyOf = (event: TranscriptEvent, index: number) => event.seq > 0 ? event.seq : `${event.kind}-${index}`;

function toolRow(event: TranscriptEvent, ctx: Ctx) {
  const callId = String(event.body.callId);
  const checkpoint = ctx.results.has(callId) ? ctx.cpAfter.get(ctx.results.get(callId)!.seq) : undefined;
  const previews = checkpoint ? checkpointPreview(ctx.events, checkpoint) : undefined;
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
    checkpoint={checkpoint} screenshot={previews?.screenshot} previous={previews?.previous} screenshots={ctx.screenshots}
    session={ctx.session} childCount={childCount} childRunning={childRunning} nested={nested.length ? nested : undefined}
    busy={ctx.busy} onOpenSession={ctx.onOpenSession} hideCheckpoint={ctx.scratch}
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
    case 'prompt': {
      const previousCheckpoint = ctx.events.filter(event => event.kind === 'checkpoint' && event.seq < e.seq).at(-1);
      const promptContexts = Array.isArray(b.context) ? b.context as PromptContext[] : [], inspectableContexts = promptContexts.filter(entry => entry.kind === 'element' || entry.kind === 'console');
      return (
        <div className="ormi-hover-zone" style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
          <div style={{ maxWidth: '78%' }}>
            <div style={{
              padding: '8px 12px', background: 'var(--bg-raised)',
              border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
              color: 'var(--text-active)', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {promptContexts.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>{promptContexts.map((entry, i) => <span key={i} style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--bg-inset)', color: 'var(--text-hint)', fontSize: 10 }}>{contextChipLabel(entry)}</span>)}</div> : null}
              {Array.isArray(b.attachments) && b.attachments.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>{(b.attachments as { name: string; size?: number }[]).map((file, i) => <span key={i} style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-inset)', color: 'var(--text-hint)', fontSize: 10 }}>{file.name}{file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ''}</span>)}</div> : null}
              {String(b.text)}
              {inspectableContexts.length ? <TranscriptContextDetails contexts={inspectableContexts} /> : null}
            </div>
            <PromptActions session={ctx.session} text={String(b.text)} checkpoint={previousCheckpoint ? String(previousCheckpoint.body.id) : undefined} onEdit={ctx.onEditPrompt} />
          </div>
        </div>
      );
    }
    case 'text':
    case 'text_delta':
      return <div className="ormi-hover-zone" style={{ padding: '2px 0' }}><Markdown text={String(b.text)} /><AgentActions session={ctx.session} text={String(b.text)} /></div>;
    case 'thinking':
    case 'thinking_delta':
      return <ThinkingRow text={String(b.text)} />;
    case 'plan':
      return <div style={{ ...mono, ...small, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{String(b.text)}</div>;
    case 'tool_call':
      if (/^mcp__ormi__ormi_browser_/.test(String(b.name ?? b.tool ?? ''))) return null;
      return toolRow(e, ctx);
    case 'browser_action':
      return <BrowserActionRow event={e} session={ctx.session} />;
    case 'ui_check':
      return <UiCheckRow event={e} session={ctx.session} />;
    case 'tool_result':
      return null;
    case 'error':
      return <ErrorRow message={String(b.message ?? b.code)} onHandoff={ctx.onHandoff} />;
    case 'turn_start':
    case 'turn_end':
      return null;
    case 'workspace_step':
      return null;
    case 'handoff_brief':
      return <HandoffRow text={String(b.text ?? '')} />;
    case 'handoff_started':
      return <div style={{ ...small, color: 'var(--text-hint)', display: 'flex', gap: 5, alignItems: 'center', margin: '4px 0' }}>
        Handed off to {String(b.target ?? 'agent')} → <button type="button" onClick={() => ctx.onOpenSession?.(String(b.child))} style={linkButton}>open</button>
      </div>;
    case 'handoff_continued':
      return <div style={{ ...small, color: 'var(--text-hint)', display: 'flex', gap: 5, alignItems: 'center', margin: '4px 0' }}>
        Continued from {String(b.parentTitle ?? b.parent)} ← <button type="button" onClick={() => ctx.onOpenSession?.(String(b.parent))} style={linkButton}>open</button>
      </div>;
    case 'resumed':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-mint)', ...small }}><RotateCw size={12} /> resumed</div>;
    case 'interrupted':
      return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-amber)', ...small }}><Pause size={12} /> interrupted{typeof b.reason === 'string' ? ` — ${b.reason}` : ''}</div>;
    case 'checkpoint':
      {
        if (ctx.attached.has(e.seq)) return null;
        const previews = checkpointPreview(ctx.events, e);
        return <div className="ormi-hover-zone" style={{ position: 'relative', height: 14 }}>
          <span style={{ position: 'absolute', right: -26, top: -4, width: 22, display: 'inline-flex', justifyContent: 'center' }}><CheckpointMark session={ctx.session} cp={e}
            screenshot={previews.screenshot} previous={previews.previous} screenshots={ctx.screenshots}
            busy={ctx.busy} onOpenSession={ctx.onOpenSession} /></span>
        </div>;
      }
    case 'checkpoint_screenshot':
      return null;
    case 'checkpoint_restored':
      return <div style={{ ...small, color: 'var(--text-hint)', display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }} title={String(b.id ?? '')}>
        <History size={11} />Restored files to checkpoint <span style={mono}>{String(b.id ?? '').slice(0, 7)}</span>
      </div>;
    case 'conversation_rewound': {
      const checkpoint = ctx.events.find(event => event.kind === 'checkpoint' && event.body.id === b.checkpoint);
      const tool = String(checkpoint?.body.tool ?? 'checkpoint');
      return <div style={{ display: 'grid', gap: 3, margin: '4px 0' }}>
        <div style={{ ...small, color: 'var(--text-hint)' }}>Rewound to {tool} · {new Date(e.ts ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        {ctx.hiddenCount ? <button type="button" onClick={ctx.toggleHidden} style={{ justifySelf: 'start', border: 0, background: 'transparent', color: 'var(--text-hint)', fontSize: 11, padding: 0, cursor: 'pointer' }}>
          Rewound · {ctx.hiddenCount} steps hidden — {ctx.showHidden ? 'hide' : 'show'}
        </button> : null}
      </div>;
    }
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

const linkButton = { border: 0, background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', padding: 0, cursor: 'pointer', textDecoration: 'underline' };

function WorkspaceStepsRow({ steps }: { steps: TranscriptEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const warning = steps.some(step => step.body.status === 'warn');
  const create = steps.find(step => step.body.step === 'create');
  const detail = String(create?.body.detail ?? '');
  const match = detail.match(/^created (.+) from (.+)$/);
  const hook = steps.find(step => step.body.step === 'resume' || step.body.step === 'teardown');
  const summary = hook?.body.step === 'resume' ? 'Resumed workspace'
    : hook?.body.step === 'teardown' ? 'Workspace teardown'
      : match ? <>Prepared worktree <span style={mono}>{match[1]}</span> from <span style={mono}>{match[2]}</span></> : 'Prepared worktree';
  const labels: Record<string, string> = { fetch: 'Fetch', create: 'Create', copy_dirty: 'Copy uncommitted changes', include: 'Include ignored files', setup: 'Setup', resume: 'Resume', teardown: 'Teardown' };
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
      {expanded ? <ChevronRight size={11} style={{ transform: 'rotate(90deg)' }} /> : <ChevronRight size={11} className="ormi-hover-reveal" />}
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
  let turnStartIndex: number | undefined;
  let turnHadTool = false;
  let workspaceShown = false;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (!includeChildren && parentOf(event)) continue;
    if (event.kind === 'turn_start') {
      turnStart = event.ts;
      turnStartIndex = i;
      turnHadTool = false;
      continue;
    }
    if (event.kind === 'tool_call' && turnStart !== undefined) turnHadTool = true;
    if (event.kind === 'turn_end') {
      if (turnStart !== undefined && turnHadTool && event.ts !== undefined) {
        rows.push(<div key={keyOf(event, i)}>{eventLine(null, durationLabel(turnStart, event.ts))}</div>);
      }
      rows.push(<ChangedFilesCard key={`changed-${keyOf(event, i)}`} session={ctx.session} events={events.slice((turnStartIndex ?? i) + 1, i)} allowDiff={!ctx.scratch} />);
      turnStart = undefined;
      turnStartIndex = undefined;
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

export function Transcript({ events, session, onHandoff, onOpenSession, onEditPrompt, busy, scratch = false }: { events: TranscriptEvent[]; session: string; onHandoff?: () => void; onOpenSession?: (session: string) => void; onEditPrompt?: (text: string) => void; busy?: boolean; scratch?: boolean }) {
  const [showHidden, setShowHidden] = useState(false);
  const rewind = [...events].reverse().find(event => event.kind === 'conversation_rewound');
  const rewindTo = typeof rewind?.body.to === 'number' ? rewind.body.to : -1;
  const hiddenCount = rewind ? events.filter(event => event.seq > rewindTo && event.seq < rewind.seq).length : 0;
  const visibleEvents = rewind && !showHidden ? events.filter(event => event.seq <= rewindTo || event.seq >= rewind.seq) : events;
  const ctx = useMemo<Ctx>(() => {
    const results = new Map<string, TranscriptEvent>(); const calls = new Set<string>(); const cpAfter = new Map<number, TranscriptEvent>(); const attached = new Set<number>();
    const children = new Map<string, TranscriptEvent[]>();
    const screenshots = checkpointScreenshots(visibleEvents);
    for (const e of visibleEvents) {
      if (e.kind === 'tool_call') calls.add(String(e.body.callId));
      else if (e.kind === 'tool_result') results.set(String(e.body.callId), e);
      const parent = parentOf(e);
      if (parent) children.set(parent, [...(children.get(parent) ?? []), e]);
    }
    const resultSeqs = new Set([...results.values()].filter(r => calls.has(String(r.body.callId))).map(r => r.seq));
    for (const e of visibleEvents) if (e.kind === 'checkpoint' && resultSeqs.has(Number(e.body.seq))) { cpAfter.set(Number(e.body.seq), e); attached.add(e.seq); }
    return { session, results, calls, cpAfter, attached, children, hiddenCount, showHidden, toggleHidden: () => setShowHidden(value => !value), events, screenshots, onHandoff, onOpenSession, onEditPrompt, busy, scratch };
  }, [visibleEvents, events, session, hiddenCount, showHidden, onHandoff, onOpenSession, onEditPrompt, busy, scratch]);
  return <TranscriptScroller count={events.length}>{renderEvents(visibleEvents, ctx)}</TranscriptScroller>;
}

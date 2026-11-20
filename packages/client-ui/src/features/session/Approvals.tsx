/** Pending approvals and questions, docked above the composer in the same
 * quiet single-line style as tool rows. Never hidden; every answer goes
 * through session.decide / session.answer with the agent's own option ids. */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ShieldQuestion, ShieldAlert, CircleHelp, ChevronRight, ChevronDown, Loader2, Check } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { shape, Detail } from './ToolRow.tsx';
import type { TranscriptEvent } from './useTranscript.ts';
import { questionAnswers } from './question-answers.ts';

const mono = { fontFamily: 'var(--font-mono)' };
type Option = { id: string; label: string; kind?: string };
type Question = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean };
const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
const isReject = (o: Option) => /reject|deny|decline|cancel|abort/i.test(o.kind ?? o.id);

/** What the agent wants to do: its own tool name + input when it sent them,
 * otherwise the tool call just before the request. */
function subject(req: TranscriptEvent, events: TranscriptEvent[]) {
  const b = req.body; const tc = obj(b.toolCall);
  if (typeof b.tool === 'string') return { name: b.tool, input: obj(b.input), raw: b.input };
  if (typeof b.command === 'string' || Array.isArray(b.command)) return { name: 'bash', input: { command: b.command, cwd: b.cwd }, raw: b };
  if (typeof tc.title === 'string') return { name: String(tc.kind ?? 'tool'), input: obj(tc.rawInput), raw: tc, title: tc.title };
  const call = [...events].reverse().find(e => e.seq < req.seq && e.kind === 'tool_call');
  if (call) return { name: String(call.body.name), input: obj(call.body.input), raw: call.body.input };
  return undefined;
}

function Choice({ label, title, primary, danger, busy, picked, onClick }: { label: string; title?: string; primary?: boolean; danger?: boolean; busy?: boolean; picked?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} title={title} className={danger ? 'ormi-choice ormi-choice-danger' : 'ormi-choice'} style={{
      font: 'inherit', fontSize: 11.5, height: 22, padding: '0 8px', borderRadius: 6, border: 'none', cursor: busy ? 'default' : 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0,
      background: primary || picked ? 'var(--bg-selected)' : 'transparent', color: primary || picked ? 'var(--text-active)' : 'var(--text-label)',
    }}>{picked ? <Check size={11} /> : null}{label}</button>
  );
}

function Line({ icon, children, actions, open, onToggle }: { icon: ReactNode; children: ReactNode; actions: ReactNode; open?: boolean; onToggle?: () => void }) {
  return (
    <div className="ormi-hover-zone" style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 26, fontSize: 12, lineHeight: '18px', color: 'var(--text-hint)', flexWrap: 'wrap', rowGap: 4 }}>
      <div onClick={onToggle} className={onToggle ? 'ormi-tool-line' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 220px', minWidth: 0, cursor: onToggle ? 'pointer' : 'default' }}>
        {icon}{children}
        {onToggle ? (open ? <ChevronDown size={11} style={{ flexShrink: 0 }} /> : <ChevronRight size={11} className="ormi-hover-reveal" style={{ flexShrink: 0 }} />) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>{actions}</div>
    </div>
  );
}

function ApprovalLine({ session, req, events }: { session: string; req: TranscriptEvent; events: TranscriptEvent[] }) {
  const { transport } = usePlatform();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const b = req.body; const destructive = Boolean(b.destructive);
  const handoff = b.approvalKind === 'handoff';
  const target = obj(b.target);
  const estimate = obj(b.estimate);
  const options = (b.options as Option[] | undefined) ?? [];
  const sub = subject(req, events);
  const s = sub ? shape(sub.name, sub.input) : undefined;
  const firstAllow = options.findIndex(o => !isReject(o));
  const firstDeny = options.find(o => isReject(o));
  const decide = async (o: Option) => {
    if (busy) return;
    setBusy(o.id); setError(undefined);
    try {
      const r = await transport.request('session.decide', { session, request: b.request, option: o.id });
      if (r.type === 'err') { setBusy(undefined); setError(String((r as { message?: string }).message ?? r.code)); }
    } catch (cause) {
      setBusy(undefined); setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || busy) return;
    const key = event.key.toLowerCase();
    if ((key === 'a' || event.key === 'Enter') && firstAllow >= 0) {
      event.preventDefault(); void decide(options[firstAllow]!);
    } else if ((key === 'd' || event.key === 'Escape') && firstDeny) {
      event.preventDefault(); void decide(firstDeny);
    }
  };
  const Icon = destructive ? ShieldAlert : ShieldQuestion;
  return (
    <div tabIndex={0} role="group" aria-label={handoff ? 'Handoff approval' : 'Tool approval'} onKeyDown={onKeyDown}>
      <Line open={open} onToggle={sub ? () => setOpen(v => !v) : undefined}
        icon={<Icon size={12} style={{ color: destructive ? 'var(--accent-red)' : 'var(--accent-amber)', flexShrink: 0 }} />}
        actions={<>
          {busy ? <Loader2 size={12} className="animate-spin" style={{ marginRight: 4 }} /> : null}
          {options.map((o, i) => <Choice key={o.id} label={o.label} primary={i === firstAllow && !destructive} danger={isReject(o)} busy={Boolean(busy)} onClick={() => void decide(o)} />)}
        </>}>
        <span style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontWeight: 500 }}>
          {handoff ? `Agent wants to hand off to ${String(target.vendor ?? 'another agent')}` : sub ? `Allow ${sub.name}` : 'Approval needed'}
        </span>
        {handoff ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{typeof estimate.usd === 'number' ? `· ~$${estimate.usd.toFixed(2)}` : '· cost unknown'}</span> : null}
        {s ? <span style={{ ...mono, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{s.target ?? s.detail ?? sub!.title ?? ''}</span> : null}
        {destructive ? <span style={{ color: 'var(--accent-red)', fontSize: 11, flexShrink: 0 }}>destructive{b.rule ? ` · ${String(b.rule)}` : ''}</span> : null}
      </Line>
      {typeof b.title === 'string' || typeof b.description === 'string' || typeof b.reason === 'string'
        ? <div style={{ fontSize: 11.5, color: 'var(--text-hint)', padding: '0 0 2px 19px' }}>{String(b.description ?? b.title ?? b.reason)}</div> : null}
      {typeof b.escalatedBy === 'string' ? <div style={{ fontSize: 11.5, color: 'var(--text-hint)', padding: '0 0 2px 19px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        Escalated by parent{typeof b.escalationReason === 'string' && b.escalationReason.trim() ? `: ${b.escalationReason}` : ''}
      </div> : null}
      {error ? <div style={{ fontSize: 11.5, color: 'var(--accent-red)', padding: '0 0 2px 19px' }}>{error}</div> : null}
      {open && sub ? <div style={{ margin: '2px 0 6px 19px', padding: '6px 9px', borderRadius: 6, background: 'var(--bg-inset)', ...mono, fontSize: 11, color: 'var(--text-label)', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <Detail name={sub.name} input={sub.input} raw={sub.raw} />
      </div> : null}
    </div>
  );
}

function QuestionLine({ session, req }: { session: string; req: TranscriptEvent }) {
  const { transport } = usePlatform();
  const questions = (req.body.questions as Question[] | undefined) ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (answers: Record<string, string[]>) => {
    const body = questionAnswers(questions, answers);
    if (busy || !body) return;
    setBusy(true); setError(undefined);
    try {
      const r = await transport.request('session.answer', { session, request: req.body.request, answers: body });
      if (r.type === 'err') { setBusy(false); setError(String((r as { message?: string }).message ?? r.code)); }
    } catch (cause) {
      setBusy(false); setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const pick = (q: Question, label: string) => {
    const cur = picked[q.question] ?? [];
    const next = { ...picked, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]) : [label] };
    setPicked(next);
    if (!questions.some(x => x.multiSelect || !x.options.length)) void send(next);
  };
  const multi = questions.some(q => q.multiSelect || !q.options.length);
  return (
    <div>
      {questions.map((q, i) => (
        <div key={q.question} tabIndex={0} role="group" aria-label={`Question: ${q.question}`} onKeyDown={event => {
          if (event.target !== event.currentTarget || busy) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (multi && questions.every(question => picked[question.question]?.length)) void send(picked);
            else if (q.options[0]) pick(q, q.options[0].label);
          } else if (event.key === 'Escape') {
            setPicked(current => ({ ...current, [q.question]: [] }));
          }
        }}>
        <Line icon={<CircleHelp size={12} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />}
          actions={<>
            {q.options.map(o => <Choice key={o.label} label={o.label} title={o.description} busy={busy} picked={(picked[q.question] ?? []).includes(o.label)} onClick={() => pick(q, o.label)} />)}
            {!q.options.length ? <input aria-label={`Answer: ${q.question}`} disabled={busy} value={picked[q.question]?.[0] ?? ''}
              onChange={event => setPicked(current => ({ ...current, [q.question]: [event.target.value] }))}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void send(picked); } }} /> : null}
            {multi && i === questions.length - 1 ? <Choice label="Send" primary busy={busy} onClick={() => void send(picked)} /> : null}
          </>}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.question}>{q.question}</span>
        </Line>
        </div>
      ))}
      {error ? <div style={{ fontSize: 11.5, color: 'var(--accent-red)', padding: '0 0 2px 19px' }}>{error}</div> : null}
    </div>
  );
}

export function Approvals({ session, pending, events }: { session: string; pending: TranscriptEvent[]; events: TranscriptEvent[] }) {
  if (!pending.length) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ width: '100%', maxWidth: 720, padding: '4px var(--space-5) 6px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pending.map(p => p.kind === 'question_request'
          ? <QuestionLine key={String(p.body.request)} session={session} req={p} />
          : <ApprovalLine key={String(p.body.request)} session={session} req={p} events={events} />)}
      </div>
    </div>
  );
}

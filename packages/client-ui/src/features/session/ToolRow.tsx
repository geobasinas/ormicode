/** Tool calls as compact expandable rows (Desktop mockups: icon, bold verb +
 *  target, stat/status on the right). The matching tool_result folds in;
 *  the checkpoint taken after it is a hover-only icon on the row. */
import { useState, type ReactNode } from 'react';
import { Pencil, Wrench, SquareTerminal, FileText, Search, Globe, ListChecks, Sparkles, Loader2, ChevronRight, ChevronDown, History, Brain } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { usePlatform } from '../../lib/platform.ts';
import type { TranscriptEvent } from './useTranscript.ts';

const mono = { fontFamily: 'var(--font-mono)' };
const hint = { color: 'var(--text-hint)' };
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const lines = (s: unknown) => typeof s === 'string' && s.length ? s.replace(/\n$/, '').split('\n').length : 0;
const str = (v: unknown) => typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : '';

interface Shape { icon: ReactNode; verb: string; target?: string; detail?: string; added?: number; removed?: number }

export function shape(name: string, input: Record<string, unknown>): Shape {
  const file = str(input.file_path ?? input.filePath ?? input.path ?? input.notebook_path);
  const ic = (I: typeof Pencil) => <I size={12} style={{ color: 'var(--text-hint)', flexShrink: 0, opacity: 0.8 }} />;
  const n = name.toLowerCase();
  if (['edit', 'multiedit', 'notebookedit', 'write', 'str_replace_based_edit_tool'].includes(n)) {
    const edits = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [input];
    const added = n === 'write' ? lines(input.content) : edits.reduce((a, e) => a + lines(e.new_string ?? e.newString), 0);
    const removed = n === 'write' ? 0 : edits.reduce((a, e) => a + lines(e.old_string ?? e.oldString), 0);
    return { icon: ic(Pencil), verb: n === 'write' ? 'Wrote' : 'Edited', target: base(file), added, removed };
  }
  if (n === 'apply_patch') return { icon: ic(Pencil), verb: 'Applied patch' };
  if (['bash', 'shell', 'exec_command', 'local_shell', 'run_terminal_cmd'].includes(n)) return { icon: ic(SquareTerminal), verb: 'Ran', detail: str(input.command ?? input.cmd) };
  if (['read', 'view', 'read_file'].includes(n)) return { icon: ic(FileText), verb: 'Read', target: base(file) };
  if (['grep', 'glob', 'search', 'ls'].includes(n)) return { icon: ic(Search), verb: n === 'ls' ? 'Listed' : 'Searched', detail: str(input.pattern ?? input.query ?? input.path) };
  if (['webfetch', 'websearch', 'web_search'].includes(n)) return { icon: ic(Globe), verb: n === 'webfetch' ? 'Fetched' : 'Searched the web', detail: str(input.url ?? input.query) };
  if (['todowrite', 'update_plan'].includes(n)) return { icon: ic(ListChecks), verb: 'Updated the plan' };
  if (['task', 'agent'].includes(n)) return { icon: ic(Sparkles), verb: 'Delegated', detail: str(input.description ?? input.prompt) };
  const summary = JSON.stringify(input);
  return { icon: ic(Wrench), verb: name, detail: summary === '{}' ? undefined : summary };
}

export function CheckpointMark({ session, cp, inline }: { session: string; cp: TranscriptEvent; inline?: boolean }) {
  const { transport } = usePlatform();
  const [note, setNote] = useState<string>();
  const id = String(cp.body.id ?? '');
  const act = async (method: string, body: Record<string, unknown>, ok: string) => {
    const r = await transport.request(method, { session, id, ...body });
    setNote(r.type === 'err' ? String((r as { message?: string }).message ?? r.code) : ok);
    setTimeout(() => setNote(undefined), 3000);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, position: 'relative' }}>
      {note ? <span style={{ ...hint, fontSize: 11, position: 'absolute', right: 26, whiteSpace: 'nowrap', background: 'var(--bg-main)', padding: '0 4px' }}>{note}</span> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="ormi-hover-reveal hv-sub" title={`checkpoint ${id.slice(0, 7)}${inline ? '' : ' · before the first tool call'}`} aria-label="checkpoint" style={{
            border: 'none', background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer', padding: 3, borderRadius: 5, display: 'inline-flex',
          }}><History size={11} /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Checkpoint {id.slice(0, 7)}{typeof cp.body.overCap === 'number' ? ' · over the size cap' : ''}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void act('checkpoint.restore', { mode: 'files' }, 'files restored')}>Restore files to here</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void act('checkpoint.fork', {}, 'forked into a new session')}>Fork a new session from here</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(id).then(() => setNote('id copied'))}>Copy checkpoint id</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

const pretty = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);

/** Expanded body: edits as a mini diff, commands as `$ cmd`, anything else as JSON. */
export function Detail({ name, input, raw }: { name: string; input: Record<string, unknown>; raw: unknown }) {
  const n = name.toLowerCase();
  const edits = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [input];
  const oldOf = (e: Record<string, unknown>) => str(e.old_string ?? e.oldString); const newOf = (e: Record<string, unknown>) => str(e.new_string ?? e.newString);
  if (['edit', 'multiedit', 'write'].includes(n) && edits.some(e => oldOf(e) || newOf(e) || input.content)) {
    const row = (l: string, c: '+' | '-', k: string) => <div key={k} style={{ background: c === '+' ? 'var(--tint-mint)' : 'var(--tint-red)', color: c === '+' ? 'var(--accent-mint)' : 'var(--accent-red)', padding: '0 6px' }}>{c} {l}</div>;
    return <div>
      <div style={{ ...hint, marginBottom: 4 }}>{str(input.file_path ?? input.filePath ?? input.path)}</div>
      {n === 'write' ? str(input.content).replace(/\n$/, '').split('\n').map((l, i) => row(l, '+', `w${i}`))
        : edits.map((e, j) => <div key={j} style={{ marginBottom: 6 }}>
          {oldOf(e).replace(/\n$/, '').split('\n').filter((_, i, a) => a.length > 1 || a[0]).map((l, i) => row(l, '-', `o${i}`))}
          {newOf(e).replace(/\n$/, '').split('\n').filter((_, i, a) => a.length > 1 || a[0]).map((l, i) => row(l, '+', `n${i}`))}
        </div>)}
    </div>;
  }
  const cmd = str(input.command ?? input.cmd);
  if (cmd) return <div style={{ color: 'var(--text-title)' }}>$ {cmd}</div>;
  return <><div style={{ ...hint, marginBottom: 4 }}>{name}</div>{pretty(raw)}</>;
}

export function ToolRow({ call, result, checkpoint, session }: { call: TranscriptEvent; result?: TranscriptEvent; checkpoint?: TranscriptEvent; session: string }) {
  const [open, setOpen] = useState(false);
  const input = (call.body.input && typeof call.body.input === 'object' ? call.body.input : {}) as Record<string, unknown>;
  const s = shape(String(call.body.name), input);
  const status = result ? String(result.body.status) : 'running';
  return (
    <div className="ormi-hover-zone ormi-tool" style={{ margin: '1px 0', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div onClick={() => setOpen(o => !o)} className="ormi-tool-line" style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0', cursor: 'pointer',
          fontSize: 12, lineHeight: '18px', color: 'var(--text-hint)',
        }}>
          {status === 'running' ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-hint)', flexShrink: 0 }} /> : s.icon}
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{s.verb}</span>{s.target ? ` ${s.target}` : ''}</span>
          <span style={{ ...mono, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{s.detail ?? ''}</span>
          {s.added || s.removed ? <span style={{ ...mono, fontSize: 11, display: 'inline-flex', gap: 5, flexShrink: 0, opacity: 0.85 }}>
            {s.added ? <span style={{ color: 'var(--accent-mint)' }}>+{s.added}</span> : null}{s.removed ? <span style={{ color: 'var(--accent-red)' }}>−{s.removed}</span> : null}
          </span> : null}
          {status === 'failed' ? <span style={{ color: 'var(--accent-red)', fontSize: 11, flexShrink: 0, opacity: 0.85 }}>failed</span>
            : status === 'interrupted' ? <span style={{ color: 'var(--accent-amber)', fontSize: 11, flexShrink: 0, opacity: 0.85 }}>interrupted</span> : null}
          {open ? <ChevronDown size={11} style={{ ...hint, flexShrink: 0 }} /> : <ChevronRight size={11} className="ormi-hover-reveal" style={{ ...hint, flexShrink: 0 }} />}
          <span style={{ flex: 1 }} />
        </div>
        {checkpoint ? <span style={{ position: 'absolute', right: -26, top: -1, width: 22, display: 'inline-flex', justifyContent: 'center' }}><CheckpointMark session={session} cp={checkpoint} inline /></span> : null}
      </div>
      {open ? <div style={{ margin: '2px 0 6px 19px', padding: '6px 9px', borderRadius: 6, background: 'var(--bg-inset)', ...mono, fontSize: 11, color: 'var(--text-label)', maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <Detail name={String(call.body.name)} input={input} raw={call.body.input} />
        {result?.body.output !== undefined ? <><div style={{ ...hint, margin: '10px 0 4px' }}>output</div>{pretty(result.body.output).slice(0, 20_000)}</> : null}
      </div> : null}
    </div>
  );
}

export function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '3px 0' }}>
      <div onClick={() => setOpen(o => !o)} className="ormi-tool-line" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, lineHeight: '18px', padding: '2px 0', ...hint }}>
        <Brain size={12} style={{ opacity: 0.8 }} />Thinking{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </div>
      {open ? <div style={{ ...mono, fontSize: 11.5, color: 'var(--text-hint)', whiteSpace: 'pre-wrap', padding: '2px 0 0 19px' }}>{text}</div> : null}
    </div>
  );
}

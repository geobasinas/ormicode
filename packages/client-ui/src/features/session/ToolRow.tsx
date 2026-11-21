/** Tool calls as compact expandable rows (Desktop mockups: icon, bold verb +
 *  target, stat/status on the right). The matching tool_result folds in;
 *  the checkpoint taken after it is a hover-only icon on the row. */
import { useEffect, useState, type ReactNode } from 'react';
import { Pencil, Wrench, SquareTerminal, FileText, Search, Globe, ListChecks, Sparkles, Loader2, ChevronRight, ChevronDown, History, Brain } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { usePlatform } from '../../lib/platform.ts';
import type { TranscriptEvent } from './useTranscript.ts';
import type { CheckpointScreenshotChoice } from './checkpoint-preview.ts';
import { CheckpointCompareDialog } from './CheckpointCompareDialog.tsx';
import { requestOpenFile } from '../../lib/openFile.ts';
import { Markdown } from './Markdown.tsx';
import { feedback } from '../../lib/feedback.ts';
import { fetchArtifact } from './fetchArtifact.ts';

const mono = { fontFamily: 'var(--font-mono)' };
const hint = { color: 'var(--text-hint)' };
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const lines = (s: unknown) => typeof s === 'string' && s.length ? s.replace(/\n$/, '').split('\n').length : 0;
const str = (v: unknown) => typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : '';

interface Shape { icon: ReactNode; verb: string; target?: string; detail?: string; added?: number; removed?: number }

export function shape(name: string, input: Record<string, unknown>): Shape {
  const file = str(input.file_path ?? input.filePath ?? input.path ?? input.notebook_path);
  const ic = (I: typeof Pencil) => <I size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />;
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
  const parts = name.split('__');
  if (parts[0]?.toLowerCase() === 'mcp') parts.shift();
  const verb = parts.map(part => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()).filter(Boolean).join(' · ') || 'Tool';
  const detail = Object.values(input).find(value => typeof value === 'string' && value.trim() && value.length <= 80);
  return { icon: ic(Wrench), verb, detail: typeof detail === 'string' ? detail.trim() : undefined };
}

type DiffFile = { path: string; added: number; removed: number };
function diffFiles(patch: string): DiffFile[] {
  const files = new Map<string, DiffFile>();
  let current: DiffFile | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = match?.[2] ?? match?.[1];
      current = path ? { path, added: 0, removed: 0 } : undefined;
      if (current) files.set(current.path, current);
    } else if (line.startsWith('+++ b/')) {
      const path = line.slice(6);
      if (current && path !== current.path) {
        files.delete(current.path);
        current.path = path;
        files.set(path, current);
      }
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) current.added++;
    else if (current && line.startsWith('-') && !line.startsWith('---')) current.removed++;
  }
  return [...files.values()];
}

export function CheckpointMark({ session, cp, screenshot = '', previous, screenshots, inline, busy, onOpenSession }: {
  session: string; cp: TranscriptEvent; screenshot?: string; previous?: { id: string; artifact: string }; screenshots?: CheckpointScreenshotChoice[]; inline?: boolean; busy?: boolean; onOpenSession?(session: string): void;
}) {
  const { transport } = usePlatform();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<DiffFile[]>();
  const [confirm, setConfirm] = useState<'files' | 'conversation'>();
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [compare, setCompare] = useState(false);
  const [preview, setPreview] = useState('');
  const [previousPreview, setPreviousPreview] = useState('');
  const id = String(cp.body.id ?? '');
  const screenshotChoices = screenshots ?? [];
  useEffect(() => {
    if (!open || !screenshot) return;
    let alive = true;
    void fetchArtifact(transport, session, screenshot).then(image => {
      if (alive) setPreview(`data:${image.mime};base64,${image.data}`);
    }).catch(() => undefined);
    if (previous?.artifact) void fetchArtifact(transport, session, previous.artifact).then(image => {
      if (alive) setPreviousPreview(`data:${image.mime};base64,${image.data}`);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, previous?.artifact, previous?.id, screenshot, id, session, transport]);
  useEffect(() => {
    if (!open) return;
    void transport.request('session.get', { session }).then(result => {
      if (result.type !== 'res') return;
      const baseBranch = String(result.body.branch ?? 'ormi');
      const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 6) ?? Math.random().toString(16).slice(2, 8);
      setBranch(`${baseBranch}-fork-${suffix}`);
    });
  }, [open, transport, session]);
  const loadDiff = async () => {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const r = await transport.request('checkpoint.diff', { session, from: id });
      if (r.type === 'err') { setError(String(r.message ?? r.code)); return; }
      const patch = String((r.body as { patch?: unknown }).patch ?? '');
      setDiff(diffFiles(patch));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  const restore = async (mode: 'files' | 'conversation', checkpointId = id) => {
    if (loading || busy) return;
    setLoading(true); setError('');
    try {
      const r = await transport.request('checkpoint.restore', { session, id: checkpointId, mode });
      if (r.type === 'err') { setError(String(r.message ?? r.code)); return; }
      setConfirm(undefined); setNote(mode === 'files' ? 'Files restored' : 'Conversation rewound');
      const undoId = (r.body as { undoId?: unknown }).undoId;
      feedback.success(mode === 'files' ? 'Files restored' : 'Conversation rewound', typeof undoId === 'string' ? {
        label: 'Undo', onClick: () => { void undoRestore(undoId); },
      } : undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  const undoRestore = async (undoId: string) => {
    if (undoing) return;
    setUndoing(true);
    try {
      const result = await transport.request('checkpoint.restore', { session, id: undoId, mode: 'files' });
      if (result.type === 'err') { feedback.error(result.message); return; }
      setNote('Restore undone');
      feedback.success('Restore undone');
    } catch (cause) { feedback.error(cause instanceof Error ? cause.message : String(cause)); }
    finally { setUndoing(false); }
  };
  const fork = async (checkpointId = id) => {
    if (loading || busy) return;
    setLoading(true); setError('');
    try {
      const r = await transport.request('checkpoint.fork', { session, id: checkpointId, branch });
      if (r.type === 'err') { setError(String(r.message ?? r.code)); return; }
      const child = (r.body as { session?: unknown }).session;
      if (typeof child === 'string') onOpenSession?.(child);
      setOpen(false);
      setCompare(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  const tool = String(cp.body.tool ?? 'checkpoint');
  const when = new Date(cp.ts ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, position: 'relative' }}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="ormi-hover-reveal hv-sub" title={`checkpoint ${id.slice(0, 7)}${inline ? '' : ' · before the first tool call'}`} aria-label="checkpoint" style={{
            border: 'none', background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer', padding: 3, borderRadius: 5, display: 'inline-flex',
          }}><History size={11} /></button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" style={{ width: 330, maxWidth: 'calc(100vw - 24px)', padding: 10, background: 'var(--bg-raised)', borderColor: 'var(--line-card)', color: 'var(--text-active)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-hint)', marginBottom: 7 }}>
            <span>{tool} · {when}</span><span style={mono}>{id.slice(0, 7)}</span>
          </div>
          {preview ? <div style={{ display: 'grid', gap: 5, marginBottom: 7 }}>
            <img alt="Checkpoint preview" src={preview} style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--bg-inset)', borderRadius: 5 }} />
            <button type="button" disabled={!previous || !previousPreview} onClick={() => setCompare(true)} style={textButton}>Compare…</button>
          </div> : null}
          <button type="button" disabled={loading} onClick={() => diff ? setDiff(undefined) : void loadDiff()} style={textButton}>
            {loading ? 'Loading…' : diff ? 'Hide changes' : 'Preview changes'}
          </button>
          {diff ? <div style={{ maxHeight: 120, overflow: 'auto', margin: '5px 0', borderTop: '1px solid var(--line-subtle)' }}>
            {diff.length ? diff.map(file => <button key={file.path} type="button" onClick={() => requestOpenFile(session, file.path, true)} style={{ ...textButton, width: '100%', justifyContent: 'flex-start', gap: 7 }}>
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{file.path}</span>
              <span style={{ color: 'var(--accent-mint)' }}>+{file.added}</span><span style={{ color: 'var(--accent-red)' }}>−{file.removed}</span>
            </button>) : <div style={{ ...hint, fontSize: 11, padding: 5 }}>No file changes</div>}
          </div> : null}
          {confirm ? <div style={{ display: 'grid', gap: 6, padding: '7px 0' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Restore {diff?.length ?? 0} changed files{confirm === 'conversation' ? ' and rewind the conversation' : ''}?</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button type="button" disabled={loading || busy} onClick={() => void restore(confirm)} style={actionButton}>{loading ? 'Restoring…' : 'Confirm restore'}</button>
              <button type="button" onClick={() => setConfirm(undefined)} style={textButton}>Cancel</button>
            </div>
          </div> : <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
            <button type="button" disabled={busy || loading} title={busy ? 'Stop the running turn before restoring' : 'Restore files'} onClick={() => { if (!diff) void loadDiff(); setConfirm('files'); }} style={actionButton}>Restore files</button>
            <button type="button" disabled={busy || loading} title={busy ? 'Stop the running turn before restoring' : 'Restore files and conversation'} onClick={() => { if (!diff) void loadDiff(); setConfirm('conversation'); }} style={actionButton}>Files & conversation</button>
          </div>}
          <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
            <input aria-label="Fork branch name" value={branch} onChange={event => setBranch(event.target.value)} style={{ ...textInput, flex: 1 }} />
            <button type="button" disabled={loading || !branch.trim()} onClick={() => void fork()} style={actionButton}>Fork</button>
          </div>
          {busy ? <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 4 }}>Disabled while a turn is running.</div> : null}
          {note ? <div style={{ fontSize: 11, color: 'var(--accent-mint)', marginTop: 4 }}>{note}</div> : null}
          {error ? <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>{error}</div> : null}
        </PopoverContent>
      </Popover>
      <CheckpointCompareDialog open={compare} onClose={() => setCompare(false)} session={session}
      choices={screenshotChoices} initialA={id} initialB={previous?.id ?? ''} busy={Boolean(busy)}
        onRestore={checkpointId => void restore('files', checkpointId)}
        onFork={checkpointId => void fork(checkpointId)} />
    </span>
  );
}

const textButton = { display: 'inline-flex', alignItems: 'center', border: 0, borderRadius: 5, padding: '4px 6px', background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', fontSize: 11, cursor: 'pointer' };
const actionButton = { border: '1px solid var(--line-card)', borderRadius: 5, padding: '4px 7px', background: 'var(--bg-inset)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 10.5, cursor: 'pointer' };
const textInput = { height: 26, minWidth: 0, padding: '0 6px', border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 10.5, outline: 'none' };

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

export function ToolRow({ call, result, checkpoint, screenshot, previous, screenshots, session, childCount = 0, childRunning, nested, hideCheckpoint }: {
  call: TranscriptEvent; result?: TranscriptEvent; checkpoint?: TranscriptEvent; screenshot?: string; previous?: { id: string; artifact: string }; screenshots?: CheckpointScreenshotChoice[]; session: string;
  childCount?: number; childRunning?: boolean; nested?: ReactNode; busy?: boolean; onOpenSession?(session: string): void; hideCheckpoint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const input = (call.body.input && typeof call.body.input === 'object' ? call.body.input : {}) as Record<string, unknown>;
  const s = shape(String(call.body.name), input);
  const status = result ? String(result.body.status) : 'running';
  const delegated = ['task', 'agent'].includes(String(call.body.name).toLowerCase());
  const file = s.target ? str(input.file_path ?? input.filePath ?? input.path ?? input.notebook_path) : '';
  return (
    <div className="ormi-hover-zone ormi-tool" style={{ margin: '1px 0', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div onClick={() => setOpen(o => !o)} className="ormi-tool-line" style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0', cursor: 'pointer',
          fontSize: 12, lineHeight: '18px', color: 'var(--text-hint)',
        }}>
          {status === 'running' ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-hint)', flexShrink: 0 }} /> : s.icon}
          <span style={{ whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{s.verb}</span>{s.target ? ' ' : ''}{s.target ? (file ? <span className="ormi-file-link" title={`Open ${file} in Files`} onClick={e => { e.stopPropagation(); requestOpenFile(session, file); }}>{s.target}</span> : s.target) : ''}</span>
          <span style={{ ...mono, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{s.detail ?? ''}</span>
          {s.added || s.removed ? <span style={{ ...mono, fontSize: 11, display: 'inline-flex', gap: 5, flexShrink: 0 }}>
            {s.added ? <span style={{ color: 'var(--accent-mint)' }}>+{s.added}</span> : null}{s.removed ? <span style={{ color: 'var(--accent-red)' }}>−{s.removed}</span> : null}
          </span> : null}
          {delegated ? <span style={{ fontSize: 10, flexShrink: 0 }}>· {childCount} steps</span> : null}
          {delegated && childRunning ? <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0 }} /> : null}
          {status === 'failed' ? <span style={{ color: 'var(--accent-red)', fontSize: 11, flexShrink: 0 }}>failed</span>
            : status === 'interrupted' ? <span style={{ color: 'var(--accent-amber)', fontSize: 11, flexShrink: 0 }}>interrupted</span> : null}
          {open ? <ChevronDown size={11} style={{ ...hint, flexShrink: 0 }} /> : <ChevronRight size={11} className="ormi-hover-reveal" style={{ ...hint, flexShrink: 0 }} />}
          <span style={{ flex: 1 }} />
        </div>
        {checkpoint && !hideCheckpoint ? <span style={{ position: 'absolute', right: -26, top: -1, width: 22, display: 'inline-flex', justifyContent: 'center' }}><CheckpointMark session={session} cp={checkpoint} screenshot={screenshot} previous={previous} screenshots={screenshots} inline /></span> : null}
      </div>
      {open ? <div style={{ margin: '2px 0 6px 19px', padding: '6px 9px', borderRadius: 6, background: 'var(--bg-inset)', ...mono, fontSize: 11, color: 'var(--text-label)', maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <Detail name={String(call.body.name)} input={input} raw={call.body.input} />
        {nested ? <div style={{ margin: '8px 0 2px 2px', paddingLeft: 9, borderLeft: '1px solid var(--line-card)' }}>{nested}</div> : null}
        {result?.body.output !== undefined ? <><div style={{ ...hint, margin: '10px 0 4px' }}>output</div>{pretty(result.body.output).slice(0, 20_000)}</> : null}
      </div> : null}
    </div>
  );
}

export function ThinkingRow({ text, openByDefault = true }: { text: string; openByDefault?: boolean }) {
  // Open by default once the agent sent thinking text, so it reads without an extra click; a click overrides.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (openByDefault && Boolean(text.trim()));
  return (
    <div style={{ margin: '3px 0' }}>
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)} className="ormi-tool-line" style={{ background: 'none', border: 0, font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, lineHeight: '18px', padding: '2px 0', ...hint }}>
        <Brain size={12} />Thinking{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open ? <div style={{ padding: '2px 0 0 19px' }}><Markdown text={text.trim() ? text : 'Thinking text was not provided by the agent.'} muted={!text.trim()} size={12} /></div> : null}
    </div>
  );
}

/** Session composer — Enter sends (session.prompt; session.steer while the agent
 * is working), Shift+Enter newline. Images by picker or paste; model, effort and
 * mode chips call session.setModel/setEffort/setMode; Stop calls session.abort. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, Square, Cpu, Gauge, X, GripVertical, FileText, History, GitBranch } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from './useSession.ts';
import { useImages, useFiles, ImageStrip, MenuChip, ModelChip, EffortChip, chip, iconBtn } from './composer-parts.tsx';
import { useModels } from './useModels.ts';
import { useComposerDraft } from './useComposerDraft.ts';
import { MentionPopover, type MentionItem } from './MentionPopover.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import type { PromptContext } from '@ormicode/protocol';
import { feedback } from '../../lib/feedback.ts';

const LIVE = new Set(['running', 'starting', 'retrying']);
type QueuedItem = { id: string; text: string; createdAt: number; images?: number; error?: string };
const APP_COMMANDS = [
  ['model', 'Choose a model'], ['effort', 'Choose effort'], ['mode', 'Choose mode'], ['handoff', 'Switch agent'],
  ['diff', 'Open Git changes'], ['files', 'Open files'], ['notes', 'Open notes'], ['stop', 'Stop the turn'], ['clear-queue', 'Clear queued prompts'],
] as const;

export function Composer({ session, details, onGit, onOpenRail, onHandoff, prefill, onPrefillApplied }: { session: string; details?: SessionDetails; onGit?: () => void; onOpenRail?: (rail: 'files' | 'notes') => void; onHandoff?: () => void; prefill?: string; onPrefillApplied?(): void }) {
  const { transport } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const { text, setText } = useComposerDraft(session);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [editText, setEditText] = useState('');
  const [dragging, setDragging] = useState<string>();
  const [dropping, setDropping] = useState(false);
  const [context, setContext] = useState<PromptContext[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRange = useRef<{ start: number; end: number } | undefined>(undefined);
  const mentionPosition = useRef({ left: 12, bottom: 40 });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyItems, setHistoryItems] = useState<{ text: string; createdAt: number }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historySelection, setHistorySelection] = useState(0);
  const savedDraft = useRef('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [agentCommands, setAgentCommands] = useState<{ name: string; description: string; source: 'agent' }[]>([]);
  const [slashAction, setSlashAction] = useState<string>();
  const [agentOptions, setAgentOptions] = useState<{ vendor: string; transports: string[] }[]>([]);
  const [error, setError] = useState<string>();
  const [modelOverride, setModelOverride] = useState<string>();
  const [effortOverride, setEffortOverride] = useState<string>();
  const img = useImages();
  const files = useFiles();
  const modelList = useModels(details?.vendor, details?.transport);
  useEffect(() => {
    if (prefill === undefined) return;
    setText(prefill);
    const frame = requestAnimationFrame(() => {
      if (!area.current) return;
      area.current.focus();
      area.current.style.height = 'auto';
      area.current.style.height = `${Math.min(area.current.scrollHeight, 168)}px`;
    });
    onPrefillApplied?.();
    return () => cancelAnimationFrame(frame);
  }, [prefill, setText, onPrefillApplied]);
  useEffect(() => { setModelOverride(undefined); }, [session, details?.model]);
  useEffect(() => { setEffortOverride(undefined); }, [session, details?.effort]);
  useEffect(() => { setContext([]); }, [session]);
  useEffect(() => {
    let active = true;
    void transport.request('prompts.history', {
      ...(details?.project ? { project: details.project } : {}),
      query: historyOpen ? historyQuery : '',
      limit: 100,
    }).then(res => {
      if (active && res.type === 'res')
        setHistoryItems((res.body as { items: { text: string; createdAt: number }[] }).items);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [transport, details?.project, historyOpen, historyQuery]);
  useEffect(() => {
    if (!slashOpen) return;
    let active = true;
    void transport.request('session.commands', { session }).then(res => {
      if (active && res.type === 'res')
        setAgentCommands((res.body as { commands: typeof agentCommands }).commands ?? []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [slashOpen, session, transport]);
  useEffect(() => {
    if (slashAction !== 'handoff') return;
    let active = true;
    void transport.request('agents.list', {}).then(res => {
      if (active && res.type === 'res') setAgentOptions((res.body as { agents: typeof agentOptions }).agents ?? []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [slashAction, transport]);
  const model = modelOverride ?? details?.model ?? 'default';
  const effort = effortOverride ?? details?.effort ?? 'default';
  const live = LIVE.has(details?.state ?? '');
  const refreshQueue = useCallback(async () => {
    const res = await transport.request('session.queue.list', { session }).catch(() => undefined);
    if (res?.type === 'res') setQueue((res.body as { items: QueuedItem[] }).items);
  }, [transport, session]);
  useEffect(() => {
    void refreshQueue();
    const timer = window.setInterval(() => { void refreshQueue(); }, 1200);
    return () => window.clearInterval(timer);
  }, [refreshQueue]);
  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };
  const call = async (method: string, body: Record<string, unknown>) => {
    setError(undefined);
    const res = await transport.request(method, { session, ...body }).catch((e: Error) => ({ type: 'err' as const, code: 'transport', message: e.message }));
    if (res.type === 'err') setError(res.code === 'agent.unsupported' ? `${details?.vendor ?? 'agent'} can't change ${res.message} here` : res.message);
    return res.type !== 'err';
  };
  const send = async (steer = false) => {
    const t = text.trim(); if (!t) return;
    const images = img.wire.length ? img.wire : undefined;
    const attachments = files.wire.length ? files.wire : undefined;
    if (live) {
      if (steer) {
        const res = await transport.request('session.steer', { session, text: t, images, attachments, context }).catch(() => undefined);
        if (res?.type === 'res') { setText(''); setContext([]); img.clear(); files.clear(); requestAnimationFrame(grow); return; }
        if (res?.type !== 'err' || res.code !== 'agent.unsupported') {
          setError(res?.type === 'err' ? res.message : 'Steering failed'); return;
        }
        setError('Steering is unavailable; queued instead.');
      }
      const queued = await transport.request('session.queue.add', { session, text: t, images, attachments, context }).catch(() => undefined);
      if (queued?.type === 'err' || !queued) {
        const message = queued?.type === 'err' ? queued.message : 'Queue failed';
        setError(message); feedback.error(message); return;
      }
      await refreshQueue();
    } else if (!await call('session.prompt', { text: t, images, attachments, context })) return;
    setContext([]);
    setText(''); img.clear(); files.clear(); requestAnimationFrame(grow);
  };
  const removeQueued = async (id: string) => {
    await transport.request('session.queue.remove', { session, id });
    await refreshQueue();
  };
  const sendQueuedNow = async (item: QueuedItem) => {
    const res = await transport.request('session.steer', { session, text: item.text });
    if (res.type === 'res') await removeQueued(item.id);
    else { setError(String(res.message)); feedback.error(String(res.message)); }
  };
  const updateQueued = async (item: QueuedItem) => {
    await transport.request('session.queue.update', { session, id: item.id, text: editText.trim() || item.text });
    setEditing(undefined); await refreshQueue();
  };
  const addFiles = async (list: FileList | File[]) => {
    const all = [...list];
    await img.add(all.filter(file => file.type.startsWith('image/')));
    await files.add(all.filter(file => !file.type.startsWith('image/')));
  };
  const pasteFiles = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const all = [...event.clipboardData.files];
    if (all.length) {
      event.preventDefault();
      void addFiles(all);
    }
  };
  const openMention = (query = '') => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    mentionRange.current = { start: caret, end: caret };
    if (el) {
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement?.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      const context2d = canvas.getContext('2d');
      if (context2d) context2d.font = getComputedStyle(el).font;
      const line = text.slice(0, caret).split('\n').at(-1) ?? '';
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
      const lineIndex = text.slice(0, caret).split('\n').length - 1;
      const left = rect.left - (parentRect?.left ?? rect.left) + (context2d?.measureText(line).width ?? 0);
      const caretTop = rect.top + 4 + lineIndex * lineHeight;
      mentionPosition.current = {
        left: Math.max(8, Math.min((parentRect?.width ?? rect.width) - 288, left)),
        bottom: Math.max(8, (parentRect?.bottom ?? rect.bottom) - caretTop + 8),
      };
    }
    setMentionItems([]);
    setMentionIndex(0);
    setMentionQuery(query); setMentionOpen(true);
  };
  const chooseMention = (item: { label: string; context: PromptContext }) => {
    const range = mentionRange.current ?? { start: text.length, end: text.length };
    const token = `@${item.label}`;
    setText(`${text.slice(0, range.start)}${token} ${text.slice(range.end)}`);
    setContext(current => [...current.filter(entry => JSON.stringify(entry) !== JSON.stringify(item.context)), item.context]);
    setMentionOpen(false); area.current?.focus();
  };
  const removeContext = (entry: PromptContext) => {
    const token = `@${entry.path ?? (entry.kind === 'diff' ? 'Diff' : entry.kind === 'terminal' ? 'Terminal' : 'Notes')}`;
    setText(value => value.replace(token, '').replace(/\s{2,}/g, ' '));
    setContext(current => current.filter(item => item !== entry));
  };
  const openHistory = () => { setHistoryQuery(''); setHistorySelection(0); setHistoryOpen(true); };
  const applyHistoryText = (value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      if (area.current) { area.current.focus(); area.current.selectionStart = area.current.selectionEnd = value.length; grow(); }
    });
  };
  const selectHistory = (item: { text: string }) => {
    setHistoryIndex(-1);
    setHistoryOpen(false);
    applyHistoryText(item.text);
  };
  const cycleHistory = (direction: -1 | 1) => {
    if (!historyItems.length) return;
    if (direction === -1) {
      if (historyIndex < 0) savedDraft.current = text;
      const next = Math.min(historyIndex + 1, historyItems.length - 1);
      setHistoryIndex(next);
      applyHistoryText(historyItems[next]!.text);
    } else if (historyIndex >= 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      applyHistoryText(next < 0 ? savedDraft.current : historyItems[next]!.text);
    }
  };
  const slashItems = [
    ...APP_COMMANDS.map(([name, description]) => ({ name, description, source: 'app' as const })),
    ...agentCommands,
  ].filter(item => item.name.toLowerCase().includes(slashQuery.toLowerCase()));
  const pickSlash = (name: string, source: 'app' | 'agent') => {
    setSlashOpen(false);
    if (source === 'agent') {
      setText(`/${name} `);
      requestAnimationFrame(() => area.current?.focus());
      return;
    }
    setText('');
    if (name === 'handoff') { onHandoff?.(); return; }
    if (['model', 'effort', 'mode'].includes(name)) { setSlashAction(name); return; }
    if (name === 'diff') onGit?.();
    if (name === 'files' || name === 'notes') onOpenRail?.(name);
    if (name === 'stop') void call('session.abort', {});
    if (name === 'clear-queue') void Promise.all(queue.map(item => transport.request('session.queue.remove', { session, id: item.id }))).then(refreshQueue);
  };
  const pickSlashValue = (kind: string, value: string) => {
    setSlashAction(undefined);
    if (kind === 'model') { setModelOverride(value); if (value !== 'default') void call('session.setModel', { model: value }); }
    if (kind === 'effort') { setEffortOverride(value); if (value !== 'default') void call('session.setEffort', { effort: value }); }
    if (kind === 'mode') void call('session.setMode', { mode: value });
  };
  const modes = details?.modes ?? [];
  const mode = details?.mode;
  const slashToken = /^\/\S+/.exec(text)?.[0];
  const slashValues = slashAction === 'model' ? modelList.models.map(item => ({ value: item.id, label: item.label || item.id }))
    : slashAction === 'effort' ? (modelList.models.find(item => item.id === model)?.efforts ?? []).map(value => ({ value, label: value }))
      : slashAction === 'mode' ? modes.map(item => ({ value: item.id, label: item.name }))
        : [];
  return (
    <div style={{ padding: '0 var(--space-5) var(--space-4)', display: 'flex', justifyContent: 'center' }}>
      <div onDragOver={event => { event.preventDefault(); setDropping(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropping(false); }} onDrop={event => { event.preventDefault(); setDropping(false); void addFiles(event.dataTransfer.files); }} style={{
        width: '100%', maxWidth: 680, background: 'var(--bg-card)', border: '1px solid var(--line-card)',
        borderRadius: 12, padding: '10px 12px 8px', boxSizing: 'border-box', minWidth: 0, position: 'relative',
      }} className="ormi-composer">
        {img.picker}
        {files.picker}
        {queue.length ? <div style={{ marginBottom: 7, display: 'grid', gap: 3 }}>
          {queue.length > 3 && !queueExpanded ? <button onClick={() => setQueueExpanded(true)} style={{ ...iconBtn, fontSize: 11, justifyContent: 'flex-start' }}>{queue.length} queued</button>
            : queue.slice(0, queueExpanded ? undefined : 3).map((item, index) => <div key={item.id} draggable onDragStart={() => setDragging(item.id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragging) void transport.request('session.queue.move', { session, id: dragging, index }).then(refreshQueue); setDragging(undefined); }} style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: 22, fontSize: 12, color: 'var(--text-secondary)' }}>
              <GripVertical size={12} style={{ color: 'var(--text-hint)', cursor: 'grab' }} />
              {editing === item.id ? <input autoFocus value={editText} onChange={event => setEditText(event.target.value)} onBlur={() => void updateQueued(item)} onKeyDown={event => { if (event.key === 'Enter') void updateQueued(item); if (event.key === 'Escape') setEditing(undefined); }} style={{ flex: 1, minWidth: 0, height: 22, padding: '0 5px', font: 'inherit', background: 'var(--bg-inset)', color: 'var(--text-active)', border: '1px solid var(--line-card)', borderRadius: 4, outline: 'none', boxShadow: 'none' }} />
                : <span onClick={() => { setEditing(item.id); setEditText(item.text); }} title={item.error ?? 'Click to edit'} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}>{item.text}</span>}
              {item.error ? <span title={item.error} style={{ color: 'var(--accent-red)', fontSize: 9 }}>invalid</span> : null}
              <button disabled={Boolean(item.error)} title={item.error} onClick={() => void sendQueuedNow(item)} style={{ ...iconBtn, fontSize: 10, padding: 2, opacity: item.error ? 0.45 : 1 }}>Send now</button>
              <button aria-label="remove queued prompt" onClick={() => void removeQueued(item.id)} style={{ ...iconBtn, padding: 2 }}><X size={12} /></button>
            </div>)}
        </div> : null}
        {context.length ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>{context.map((entry, index) => <span key={`${entry.kind}-${entry.path ?? ''}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 5, padding: '2px 5px', color: 'var(--text-secondary)', background: 'var(--bg-inset)', fontSize: 10 }}>@{entry.path ?? (entry.kind === 'diff' ? 'Diff' : entry.kind === 'terminal' ? 'Terminal' : 'Notes')}<button onClick={() => removeContext(entry)} style={iconBtn}><X size={10} /></button></span>)}</div> : null}
        <ImageStrip images={img.images} onRemove={img.remove} />
        {files.files.length ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '2px 0 6px' }}>{files.files.map((file, index) => <span key={`${file.name}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 190, fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 5, padding: '3px 5px' }}><FileText size={11} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name} · {Math.ceil(file.size / 1024)} KB</span><button onClick={() => files.remove(index)} style={iconBtn}><X size={10} /></button></span>)}</div> : null}
        <textarea
          ref={area}
          value={text}
          onChange={e => {
            const value = e.target.value; setText(value); grow();
            setHistoryIndex(-1);
            setContext(current => current.filter(entry => value.includes(`@${entry.path ?? (entry.kind === 'diff' ? 'Diff' : entry.kind === 'terminal' ? 'Terminal' : 'Notes')}`)));
            const before = value.slice(0, e.target.selectionStart);
            const match = /(^|\s)@([^\s]*)$/.exec(before);
            if (match) { const start = e.target.selectionStart - match[2]!.length - 1; mentionRange.current = { start, end: e.target.selectionStart }; openMention(match[2]); }
            else setMentionOpen(false);
            const slash = /^\/([^\s]*)$/.exec(before);
            if (slash && e.target.selectionStart === value.length) { setSlashQuery(slash[1]!); setSlashIndex(0); setSlashOpen(true); }
            else setSlashOpen(false);
          }}
          onPaste={pasteFiles}
          onKeyDown={e => {
            if (mentionOpen && mentionItems.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : mentionItems.length - 1)) % mentionItems.length); }
            else if (mentionOpen && (e.key === 'Enter' || e.key === 'Tab') && mentionItems.length) { e.preventDefault(); chooseMention(mentionItems[mentionIndex]!); }
            else if (mentionOpen && e.key === 'Escape') setMentionOpen(false);
            else if (slashOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && slashItems.length) { e.preventDefault(); setSlashIndex(index => (index + (e.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length); }
            else if (slashOpen && (e.key === 'Enter' || e.key === 'Tab') && slashItems[slashIndex]) { e.preventDefault(); pickSlash(slashItems[slashIndex]!.name, slashItems[slashIndex]!.source); }
            else if (slashOpen && e.key === 'Escape') setSlashOpen(false);
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); openHistory(); }
            else if (e.key === 'ArrowUp' && (historyIndex >= 0 || !text.trim() || e.currentTarget.selectionStart <= (text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')))) { e.preventDefault(); cycleHistory(-1); }
            else if (e.key === 'ArrowDown' && historyIndex >= 0) { e.preventDefault(); cycleHistory(1); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e.metaKey || e.ctrlKey); }
          }}
          placeholder={live ? error?.startsWith('Steering is unavailable') ? 'Queue a follow-up… (steering unavailable)' : 'Queue a follow-up… (Ctrl+Enter to steer)' : 'Reply…'} aria-label="prompt" rows={1}
          style={{
            width: '100%', resize: 'none', font: 'inherit', fontSize: 13, lineHeight: 1.5,
            color: 'var(--text-active)', background: 'transparent', border: 'none', outline: 'none',
            padding: '4px 0 6px', maxHeight: 168, overflow: 'hidden',
            backgroundImage: slashToken ? 'linear-gradient(var(--bg-inset), var(--bg-inset))' : undefined,
            backgroundSize: slashToken ? `${slashToken.length * 7}px 17px` : undefined,
            backgroundRepeat: 'no-repeat', backgroundPosition: '0 4px',
          }}
        />
        {error || img.error || files.error ? <div style={{ color: 'var(--accent-red)', fontSize: 11, marginBottom: 4 }}>{error ?? img.error ?? files.error}</div> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DropdownMenu><DropdownMenuTrigger asChild><button className="hv-sub" style={{ ...iconBtn, flexShrink: 0 }} title="attach" aria-label="attach"><Plus size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => img.pick()}>Images…</DropdownMenuItem><DropdownMenuItem onSelect={() => files.pick()}>Files…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <button className="ormi-narrow-hide" style={iconBtn} title="Mention files or context" onClick={() => openMention()}><AtSign size={15} /></button>
          <button className="ormi-narrow-hide" style={iconBtn} title="Prompt history (Ctrl+R)" onClick={openHistory}><History size={14} /></button>
          <button className="ormi-narrow-hide" style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }} title="voice (soon)" disabled><Mic size={15} /></button>
          <span style={{ flex: 1, minWidth: 4 }} />
          {details?.project !== 'scratch' && details?.branch ? (
            <button
              className="ormi-narrow-hide hv-sub"
              onClick={onGit}
              title={`${details.branch} · ${details.worktree ? 'worktree' : 'main checkout'}`}
              aria-label={`Git branch ${details.branch}${details.worktree ? ', worktree' : ', main checkout'}`}
              style={{
                ...chip, maxWidth: 140, minWidth: 0, flexShrink: 1,
                fontFamily: 'var(--font-mono)', fontSize: 11, cursor: onGit ? 'pointer' : 'default',
              }}
            >
              <GitBranch size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{details.branch}</span>
              {details.worktree ? <span style={{ color: 'var(--text-hint)', fontSize: 9, flexShrink: 0 }}>wt</span> : null}
            </button>
          ) : null}
          {details?.vendor ? <span className="ormi-narrow-hide" style={{ ...chip, cursor: 'default', flexShrink: 0 }} title="agent · transport">{details.vendor}<span style={{ color: 'var(--text-hint)' }}>{details.transport}</span></span> : null}
          {modes.length ? <MenuChip title="mode" label="Mode" value={mode ?? modes[0]!.id} choices={modes.map(m => ({ value: m.id, name: m.name }))} onChange={v => void call('session.setMode', { mode: v })} /> : null}
          {details ? <ModelChip title="model — the vendor's model id" icon={<Cpu size={11} style={{ color: 'var(--text-hint)' }} />} value={model} models={modelList.models} loading={modelList.loading} refresh={modelList.refresh} onChange={v => { setModelOverride(v); if (v !== 'default') void call('session.setModel', { model: v }).then(ok => { if (!ok) setModelOverride(undefined); }); }} /> : null}
          {details ? <EffortChip title="effort — the vendor's own word" icon={<Gauge size={11} style={{ color: 'var(--text-hint)' }} />} value={effort} model={model} models={modelList.models} onChange={v => { setEffortOverride(v); if (v !== 'default') void call('session.setEffort', { effort: v }).then(ok => { if (!ok) setEffortOverride(undefined); }); }} /> : null}
          {live && !text.trim() ? (
            <button onClick={() => void call('session.abort', {})} title="stop the turn" aria-label="stop" style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2, flexShrink: 0,
              background: 'var(--text-active)', color: 'var(--text-onAccent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><Square size={10} fill="currentColor" /></button>
          ) : (
            <button onClick={() => void send(false)} title={live ? 'queue follow-up' : 'send'} aria-label="send" style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2, flexShrink: 0,
              background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.5,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><ArrowUp size={15} strokeWidth={2.5} /></button>
          )}
        </div>
        <MentionPopover open={mentionOpen} query={mentionQuery} project={details?.project} session={session} hideDiff={details?.project === 'scratch'}
          position={mentionPosition.current} items={mentionItems} selectedIndex={mentionIndex}
          onItemsChange={setMentionItems} onPick={chooseMention} />
        {slashOpen || slashAction ? <div style={{ position: 'absolute', left: 12, bottom: 48, width: 300, maxWidth: 'calc(100vw - 40px)', maxHeight: 320, zIndex: 24, overflowY: 'auto', background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 9, boxShadow: 'var(--shadow-md)', padding: 5 }}>
          {slashAction ? <>
            <div style={{ padding: '4px 6px', color: 'var(--text-hint)', fontSize: 10 }}>{slashAction === 'handoff' ? 'Handoff target' : `Choose ${slashAction}`}</div>
            {slashAction === 'handoff' ? agentOptions.flatMap(agent => agent.transports.map(transportName => <button key={`${agent.vendor}/${transportName}`} onClick={() => { void transport.request('session.handoff', { session, mode: 'rehydrate', to: { vendor: agent.vendor, transport: transportName } }); setSlashAction(undefined); }} style={{ width: '100%', padding: '6px', border: 0, background: 'transparent', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>{agent.vendor} · {transportName}</button>)) : slashValues.map(item => <button key={item.value} onClick={() => pickSlashValue(slashAction, item.value)} style={{ width: '100%', padding: '6px', border: 0, background: 'transparent', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>{item.label}</button>)}
            <button onClick={() => setSlashAction(undefined)} style={{ ...iconBtn, fontSize: 10 }}>Cancel</button>
          </> : slashItems.map((item, index) => <button key={`${item.source}-${item.name}`} onMouseDown={event => event.preventDefault()} onClick={() => pickSlash(item.name, item.source)} style={{ width: '100%', display: 'flex', gap: 8, padding: '6px', border: 0, borderRadius: 5, background: slashIndex === index ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>
            <span style={{ color: 'var(--text-title)', fontFamily: 'var(--font-mono)' }}>/{item.name}</span><span style={{ color: 'var(--text-hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</span>
          </button>)}
        </div> : null}
        {historyOpen ? <div style={{ position: 'absolute', left: 12, bottom: 48, width: 340, maxWidth: 'calc(100vw - 40px)', maxHeight: 300, zIndex: 22, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 9, boxShadow: 'var(--shadow-md)', padding: 5 }}>
          <input autoFocus value={historyQuery} placeholder="Search prompt history…" onChange={event => { setHistoryQuery(event.target.value); setHistorySelection(0); }} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHistorySelection(index => Math.min(index + 1, historyItems.length - 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setHistorySelection(index => Math.max(index - 1, 0)); }
            else if (event.key === 'Enter' && historyItems[historySelection]) { event.preventDefault(); selectHistory(historyItems[historySelection]!); }
            else if (event.key === 'Escape') setHistoryOpen(false);
          }} style={{ height: 26, padding: '0 7px', borderRadius: 5, border: '1px solid var(--line-card)', background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 11, outline: 'none' }} />
          <div style={{ overflowY: 'auto', marginTop: 4 }}>
            {historyItems.map((item, index) => <button key={`${item.createdAt}-${index}`} onMouseDown={event => event.preventDefault()} onClick={() => selectHistory(item)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', border: 0, borderRadius: 5, background: historySelection === index ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', font: 'inherit', fontSize: 11, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
              <span style={{ flexShrink: 0, color: 'var(--text-hint)', fontSize: 9 }}>{new Date(item.createdAt).toLocaleDateString()}</span>
            </button>)}
            {!historyItems.length ? <div style={{ padding: 8, color: 'var(--text-hint)', fontSize: 11 }}>No matching prompts</div> : null}
          </div>
        </div> : null}
        {dropping ? <div style={{ position: 'absolute', inset: 4, border: '1px dashed var(--text-hint)', borderRadius: 9, background: 'color-mix(in srgb, var(--bg-raised) 88%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)', fontSize: 12, pointerEvents: 'none' }}>Drop to attach</div> : null}
      </div>
    </div>
  );
}

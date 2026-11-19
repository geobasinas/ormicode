import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { pushToComposer } from '../../lib/composer-inbox.ts';
import { usePlatform } from '../../lib/platform.ts';
import type { DesignDocument, DesignFrame, DesignOperation, DesignHistorySummary } from '@ormicode/protocol';
import { DesignFramePreview } from './DesignFramePreview.tsx';
import { sanitizeMarkup } from './sanitize.ts';
import { COLOR_CHOICES, fitView, reconcileFrameSelection, resizeRect, validateStyleEdit, zoomAt, type Rect, type View } from './design-model.ts';

type BoardSummary = { slug: string; name: string; revision: number; frames: number };
type Result = { document: DesignDocument; history: DesignHistorySummary[] };
type ElementSelection = { id: string; tag: string; leaf: boolean; text: string; styles: Record<string, string> };
type Drag = { kind: 'move' | 'resize'; id: string; startX: number; startY: number; initial: Rect; preview: Rect };
type Props = { session: string; expanded?: boolean; onExpandedChange?(expanded: boolean): void; composerSlot?: ReactNode };

const control: React.CSSProperties = { border: '1px solid var(--line-divider)', background: 'var(--bg-card)', color: 'var(--text-label)', borderRadius: 6, padding: '5px 8px', fontSize: 11, cursor: 'pointer' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--line-divider)', background: 'var(--bg-inset)', color: 'var(--text-title)', borderRadius: 5, padding: '6px 7px', font: 'inherit', fontSize: 11 };
const textArea: React.CSSProperties = { ...input, resize: 'vertical', minHeight: 82, fontFamily: 'var(--font-mono, monospace)' };
const startHtml = '<main style="min-height:100%;padding:32px;font-family:Inter,system-ui,sans-serif;color:var(--text-title);background:var(--bg-main)"><h1>Start designing</h1><p>Select this text to edit it, or add an element from the toolbar.</p></main>';
const token = (frame: DesignFrame) => ({ ...frame, width: frame.width, height: frame.height });

function Button({ children, onClick, title, disabled, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} title={title} onClick={onClick} disabled={disabled} style={{ ...control, opacity: disabled ? 0.55 : 1, ...style }}>{children}</button>;
}

export function DesignWorkspace({ session, expanded = false, onExpandedChange, composerSlot }: Props) {
  const { transport } = usePlatform();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [slug, setSlug] = useState('');
  const [document, setDocument] = useState<DesignDocument | null>(null);
  const [history, setHistory] = useState<DesignHistorySummary[]>([]);
  const [selectedFrame, setSelectedFrame] = useState('');
  const [selectedElement, setSelectedElement] = useState<ElementSelection | null>(null);
  const [tab, setTab] = useState<'inspect' | 'html' | 'feedback' | 'history'>('inspect');
  const [sourceHtml, setSourceHtml] = useState('');
  const [sourceStyles, setSourceStyles] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<Rect | null>(null);
  const board = useRef<DesignDocument | null>(null);
  const selectedFrameRef = useRef('');
  selectedFrameRef.current = selectedFrame;
  const slugRef = useRef('');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const canvas = useRef<HTMLDivElement>(null);
  const fittedSlug = useRef('');
  const bridge: MutableRefObject<(type: string, body?: Record<string, unknown>) => void> = useRef(() => undefined);
  const drag = useRef<Drag | null>(null);

  const setCurrent = useCallback((next: Result) => {
    board.current = next.document;
    setDocument(next.document);
    setHistory(next.history);
    setBoards(current => current.map(item => item.slug === slugRef.current ? { ...item, name: next.document.name, revision: next.document.revision, frames: next.document.frames.length } : item));
    setRemoteRevision(null);
    const selected = reconcileFrameSelection(next.document.frames, selectedFrameRef.current);
    if (selected !== selectedFrameRef.current) { setSelectedFrame(selected); setSelectedElement(null); }
    if (!dirtyRef.current) {
      const frame = next.document.frames.find(item => item.id === selected);
      setSourceHtml(frame?.html ?? ''); setSourceStyles(frame?.styles ?? '');
    }
  }, []);

  const readBoard = useCallback(async (target: string, discardDraft = false) => {
    if (dirtyRef.current && !discardDraft) { setError('Unsaved HTML is preserved. Save it or discard it before reloading.'); return; }
    if (!target) { generation.current++; setLoading(false); savingRef.current = false; setSaving(false); setSlug(''); slugRef.current = ''; setDocument(null); board.current = null; setHistory([]); setSelectedFrame(''); setSelectedElement(null); return; }
    const token = ++generation.current;
    fittedSlug.current = slugRef.current === target ? fittedSlug.current : '';
    savingRef.current = false; setSaving(false);
    setLoading(true); setError(''); setSlug(target); slugRef.current = target; setDocument(null); board.current = null;
    try {
      const response = await transport.request('design.get', { session, slug: target });
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      const result = response.body as Result;
      setCurrent(result);
      setSelectedElement(null); dirtyRef.current = false; setSourceDirty(false);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) setLoading(false); }
  }, [session, transport, setCurrent]);

  useEffect(() => {
    const token = ++generation.current;
    setBoards([]); setSlug(''); slugRef.current = ''; setDocument(null); board.current = null; setSelectedFrame('');
    setHistory([]); setError(''); dirtyRef.current = false; setSourceDirty(false); setRemoteRevision(null); fittedSlug.current = ''; savingRef.current = false; setSaving(false); setLoading(false);
    void transport.request('design.list', { session }).then(response => {
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      const items = (response.body as { boards: BoardSummary[] }).boards;
      setBoards(items);
      if (items[0]) void readBoard(items[0].slug);
    }).catch(reason => { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { generation.current++; };
  }, [session, transport, readBoard]);

  const reloadCurrent = useCallback(async () => {
    const currentSlug = slugRef.current;
    if (currentSlug) await readBoard(currentSlug);
  }, [readBoard]);

  useEffect(() => transport.subscribeEvents(frame => {
    if (frame.type !== 'evt' || frame.session !== session) return;
    const event = frame.body as Record<string, unknown>;
    if (event.kind !== 'design_changed' || typeof event.revision !== 'number') return;
    const token = generation.current;
    void transport.request('design.list', { session }).then(response => { if (token === generation.current && response.type === 'res') setBoards((response.body as { boards: BoardSummary[] }).boards); }).catch(() => undefined);
    if (event.slug !== slugRef.current) return;
    if ((board.current?.revision ?? 0) >= event.revision) return;
    setRemoteRevision(event.revision);
    if (!dirtyRef.current && !savingRef.current) void reloadCurrent();
  }), [session, transport, reloadCurrent]);

  const mutate = useCallback(async (operations: DesignOperation[]) => {
    const current = board.current; const currentSlug = slugRef.current; const token = generation.current;
    if (!current || !currentSlug || savingRef.current) return false;
    const sourceSave = sourceDirty && operations.length === 1 && operations[0].type === 'frame.update' && operations[0].frameId === selectedFrame && (operations[0].patch.html !== undefined || operations[0].patch.styles !== undefined);
    if (sourceDirty && !sourceSave) { setError('Save or discard the unsaved HTML before changing the board.'); return false; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await transport.request('design.update', { session, slug: currentSlug, expectedRevision: current.revision, operations });
      if (token !== generation.current) return false;
      if (response.type === 'err') {
        setError(`${response.code}: ${response.message}`);
        if (response.code === 'design.conflict') setRemoteRevision(null);
        return false;
      }
      const result = response.body as Result;
      if (!board.current || result.document.revision >= board.current.revision) setCurrent(result);
      if (sourceSave) {
        dirtyRef.current = false; setSourceDirty(false);
        const saved = result.document.frames.find(frame => frame.id === selectedFrame);
        if (saved) { setSourceHtml(saved.html); setSourceStyles(saved.styles); }
      }
      return true;
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { if (token === generation.current) { savingRef.current = false; setSaving(false); } }
  }, [session, transport, setCurrent, sourceDirty, selectedFrame]);

  const createBoard = async () => {
    if (dirtyRef.current) { setError('Save or discard the unsaved HTML before creating another board.'); return; }
    const token = generation.current;
    const cleanSlug = newSlug.trim(); const title = newName.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(cleanSlug) || !title) { setError('Use a lowercase board slug and a non-empty name.'); return; }
    setLoading(true); setError('');
    try {
      const response = await transport.request('design.create', { session, slug: cleanSlug, name: title });
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      setNewSlug(''); setNewName(''); setCreateOpen(false); setBoards(items => [...items, { slug: cleanSlug, name: title, revision: 1, frames: 0 }].sort((a, b) => a.slug.localeCompare(b.slug)));
      void readBoard(cleanSlug, true);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) setLoading(false); }
  };

  const activeFrame = document?.frames.find(frame => frame.id === selectedFrame);
  const previewFrame = activeFrame && sourceDirty ? { ...activeFrame, html: sourceHtml, styles: sourceStyles } : activeFrame;
  const frameRect = (frame: DesignFrame): Rect => dragPreview && drag.current?.id === frame.id ? dragPreview : token(frame);
  const updateSource = (field: 'html' | 'styles', value: string) => {
    if (value.length > (field === 'html' ? 24576 : 16384)) { setError(`${field} exceeds its size limit.`); return; }
    if (field === 'html') setSourceHtml(value); else setSourceStyles(value);
    dirtyRef.current = true; setSourceDirty(true); setError('');
  };
  const chooseFrame = (id: string) => {
    if (dirtyRef.current) { setError('Save or discard the unsaved HTML before switching frames.'); return; }
    setSelectedFrame(id); setSelectedElement(null);
    const frame = document?.frames.find(item => item.id === id);
    setSourceHtml(frame?.html ?? ''); setSourceStyles(frame?.styles ?? '');
  };
  const saveSource = () => { if (selectedFrame) void mutate([{ type: 'frame.update', frameId: selectedFrame, patch: { html: sanitizeMarkup(sourceHtml), styles: sourceStyles } }]); };
  const directMarkup = (id: string, html: string) => {
    const token = generation.current;
    if (!dirtyRef.current) void mutate([{ type: 'frame.update', frameId: id, patch: { html } }]).then(ok => {
      if (!ok && token === generation.current && selectedFrameRef.current === id) { dirtyRef.current = true; setSourceDirty(true); setSourceHtml(html); setTab('html'); }
    });
  };
  const addFrame = (kind: 'desktop' | 'phone' | 'blank') => {
    if (!document) return;
    const index = document.frames.length;
    const width = kind === 'phone' ? 390 : kind === 'desktop' ? 1440 : 900;
    const height = kind === 'phone' ? 844 : kind === 'desktop' ? 900 : 650;
    const frame: Omit<DesignFrame, 'id'> = { name: `${kind === 'phone' ? 'Phone' : kind === 'desktop' ? 'Desktop' : 'Blank'} ${index + 1}`, x: 60 + index * 36, y: 60 + index * 36, width, height, html: kind === 'blank' ? '<main style="min-height:100%;padding:24px"></main>' : startHtml, styles: '' };
    void mutate([{ type: 'frame.add', ...frame }]);
  };

  const startDrag = (event: React.PointerEvent, kind: Drag['kind'], frame: DesignFrame) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const initial = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    drag.current = { kind, id: frame.id, startX: event.clientX, startY: event.clientY, initial, preview: initial };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    chooseFrame(frame.id);
  };
  const moveDrag = (event: React.PointerEvent) => {
    const active = drag.current; if (!active) return;
    const dx = (event.clientX - active.startX) / view.scale; const dy = (event.clientY - active.startY) / view.scale;
    if (!active.id) { setView(current => ({ ...current, x: active.initial.x + event.clientX - active.startX, y: active.initial.y + event.clientY - active.startY })); return; }
    active.preview = active.kind === 'resize' ? resizeRect(active.initial, dx, dy) : { ...active.initial, x: Math.max(-100000, Math.min(100000, active.initial.x + dx)), y: Math.max(-100000, Math.min(100000, active.initial.y + dy)) };
    setDragPreview(active.preview);
  };
  const endDrag = () => {
    const active = drag.current; if (!active) return;
    drag.current = null; setDragPreview(null);
    if (!active.id) return;
    const patch = active.kind === 'resize' ? { width: Math.round(active.preview.width), height: Math.round(active.preview.height) } : { x: Math.round(active.preview.x), y: Math.round(active.preview.y) };
    void mutate([{ type: 'frame.update', frameId: active.id, patch }]);
  };

  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => setCanvasSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, [slug, Boolean(document)]);
  useEffect(() => {
    if (document?.frames.length && slug && fittedSlug.current !== slug && canvasSize.width > 0 && canvasSize.height > 0) {
      fittedSlug.current = slug;
      setView(fitView(document.frames, canvasSize.width, canvasSize.height));
    }
  }, [slug, document, canvasSize.width, canvasSize.height]);

  const selectedElementRef = useRef<ElementSelection | null>(null);
  selectedElementRef.current = selectedElement;
  const sendText = () => { const selected = selectedElementRef.current; if (selected?.leaf && !savingRef.current && !dirtyRef.current) bridge.current('editText', { id: selected.id, text: selected.text }); };
  const sendStyle = (property: string, value: string) => {
    if (savingRef.current || dirtyRef.current) return;
    const selected = selectedElementRef.current;
    if (!validateStyleEdit(property, value)) { setError(`Invalid value for ${property}.`); return; }
    if (selected) bridge.current('editStyle', { id: selected.id, property, value });
  };
  const zoom = (factor: number) => setView(current => zoomAt(current, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, factor));
  const addElement = (kind: string) => { if (!savingRef.current && !dirtyRef.current) bridge.current('addElement', { kind }); };
  const createComment = () => {
    const text = feedback.trim(); if (!text) return;
    void mutate([{ type: 'comment.add', frameId: selectedFrame || null, ...(selectedElement ? { element: `${selectedElement.tag}${selectedElement.text ? `: ${selectedElement.text.slice(0, 100)}` : ''}` } : {}), text }]).then(ok => { if (ok) setFeedback(''); });
  };
  const selectedComments = useMemo(() => document?.comments ?? [], [document?.comments]);

  return <div style={{ position: expanded ? 'fixed' : 'relative', inset: expanded ? '48px 8px 8px' : undefined, zIndex: expanded ? 100 : undefined, height: expanded ? undefined : '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', color: 'var(--text-title)', border: '1px solid var(--line-divider)', borderRadius: expanded ? 10 : 0, overflow: 'hidden', fontSize: 11 }}>
    <header style={{ minHeight: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--line-divider)' }}>
      <strong style={{ marginRight: 4 }}>Design</strong>
      <select aria-label="Design board" value={slug} onChange={event => void readBoard(event.target.value)} style={{ ...input, width: 150 }}>
        <option value="">Choose a board…</option>{boards.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
      </select>
      <Button title="Reload board" disabled={!slug || loading} onClick={() => void reloadCurrent()}>Reload</Button>
      <Button title="Create a design board" onClick={() => setCreateOpen(open => !open)}>New board</Button>
      {onExpandedChange ? <Button title="Expand workspace" onClick={() => onExpandedChange(!expanded)}>{expanded ? 'Return to session' : 'Expand'}</Button> : null}
      <span style={{ marginLeft: 'auto', color: saving ? 'var(--accent-amber)' : 'var(--text-hint)' }} role="status">{saving ? 'Saving…' : document ? `r${document.revision}` : ''}</span>
    </header>
    {createOpen ? <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 7, borderBottom: '1px solid var(--line-divider)' }}>
      <input aria-label="New board slug" placeholder="board-slug" value={newSlug} onChange={event => setNewSlug(event.target.value)} style={{ ...input, maxWidth: 150 }} />
      <input aria-label="New board name" placeholder="Board name" value={newName} onChange={event => setNewName(event.target.value)} style={input} />
      <Button disabled={loading} onClick={() => void createBoard()}>Create</Button>
    </div> : null}
    {!slug ? <div style={{ padding: 24, maxWidth: 560, margin: 'auto', lineHeight: 1.6 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Start a shared design board</h2>
      <p>Boards are saved in <code>designs/&lt;slug&gt;/workspace.json</code> in this session’s working tree. People and agents use the same revision-checked operations.</p>
      {boards.length ? <p>Choose an existing board above, or create another one below.</p> : <p>There are no boards yet. You can start here or ask the agent to create one with its design tools.</p>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input aria-label="Board slug" placeholder="board-slug" value={newSlug} onChange={event => setNewSlug(event.target.value)} style={{ ...input, maxWidth: 150 }} />
        <input aria-label="Board name" placeholder="Board name" value={newName} onChange={event => setNewName(event.target.value)} style={input} />
        <Button disabled={loading} onClick={() => void createBoard()}>Create board</Button>
      </div>
      {error ? <p role="alert" style={{ color: 'var(--accent-red)' }}>{error}</p> : null}
    </div> : loading && !document ? <div style={{ margin: 'auto', color: 'var(--text-hint)' }}>Loading design board…</div> : !document ? <div role="alert" style={{ margin: 'auto', color: 'var(--accent-red)' }}>{error || 'Board could not be loaded.'}</div> : <>
      <div style={{ minHeight: 36, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderBottom: '1px solid var(--line-divider)', overflowX: 'auto' }}>
        <Button onClick={() => addFrame('desktop')}>+ Desktop</Button><Button onClick={() => addFrame('phone')}>+ Phone</Button><Button onClick={() => addFrame('blank')}>+ Blank</Button>
        <span style={{ width: 1, height: 22, background: 'var(--line-divider)', margin: '0 4px' }} />
        <Button aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>−</Button><Button aria-label="Zoom in" onClick={() => zoom(1.2)}>+</Button>
        <Button onClick={() => setView(fitView(document.frames, canvasSize.width, canvasSize.height))}>Fit</Button>
        <span aria-label="Canvas zoom" style={{ color: 'var(--text-hint)', minWidth: 36 }}>{Math.round(view.scale * 100)}%</span>
        {selectedFrame ? <><Button disabled={saving || sourceDirty} onClick={() => addElement('text')}>+ Text</Button><Button disabled={saving || sourceDirty} onClick={() => addElement('button')}>+ Button</Button><Button disabled={saving || sourceDirty} onClick={() => addElement('container')}>+ Container</Button></> : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {activeFrame ? <Button onClick={() => void mutate([{ type: 'frame.duplicate', frameId: activeFrame.id }])}>Duplicate</Button> : null}
          {activeFrame ? <Button onClick={() => void mutate([{ type: 'frame.remove', frameId: activeFrame.id }])}>Delete</Button> : null}
          <Button onClick={() => void mutate([{ type: 'direction.select', frameId: selectedFrame || null }])}>{document.workingFrameId === selectedFrame ? 'Working direction ✓' : 'Set working direction'}</Button>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside aria-label="Frames" style={{ width: 142, flexShrink: 0, borderRight: '1px solid var(--line-divider)', overflowY: 'auto', padding: 6 }}>
          <div style={{ color: 'var(--text-hint)', padding: '4px 3px 8px' }}>FRAMES ({document.frames.length})</div>
          {document.frames.map(frame => <button key={frame.id} onClick={() => chooseFrame(frame.id)} aria-pressed={frame.id === selectedFrame} style={{ ...control, display: 'block', width: '100%', textAlign: 'left', marginBottom: 5, borderColor: frame.id === selectedFrame ? 'var(--accent-mint)' : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{frame.name}{document.workingFrameId === frame.id ? ' ★' : ''}</button>)}
          {!document.frames.length ? <span style={{ color: 'var(--text-hint)' }}>Add a frame above.</span> : null}
        </aside>
        <div ref={canvas} aria-label="Design canvas" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerDown={event => { if (event.target !== canvas.current || event.button !== 0) return; drag.current = { kind: 'move', id: '', startX: event.clientX, startY: event.clientY, initial: { x: view.x, y: view.y, width: 0, height: 0 }, preview: { x: view.x, y: view.y, width: 0, height: 0 } }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }}
          onWheel={event => { event.preventDefault(); const box = canvas.current?.getBoundingClientRect(); if (!box) return; if (event.ctrlKey || event.metaKey) setView(current => zoomAt(current, { x: event.clientX - box.left, y: event.clientY - box.top }, Math.exp(-event.deltaY * 0.002))); else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY })); }}
          style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden', background: 'var(--bg-inset)', touchAction: 'none', cursor: drag.current?.id === '' ? 'grabbing' : 'grab' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            {document.frames.map(frame => {
              const rect = frameRect(frame);
              const visible = previewFrame?.id === frame.id ? previewFrame : frame;
              return <div key={frame.id} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height + 28, boxSizing: 'content-box', border: frame.id === selectedFrame ? '2px solid var(--accent-mint)' : '1px solid var(--line-divider)', borderRadius: 5, overflow: 'hidden', background: '#fff', boxShadow: '0 8px 24px #0005' }}>
                <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', background: 'var(--bg-card)', borderBottom: '1px solid var(--line-divider)', boxSizing: 'border-box' }}>
                  <button onPointerDown={event => startDrag(event, 'move', frame)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); void mutate([{ type: 'frame.update', frameId: frame.id, patch: { x: frame.x + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0), y: frame.y + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0) } }]); } }} aria-label={`Move ${frame.name}; use arrow keys to arrange`} style={{ border: 0, background: 'transparent', color: 'var(--text-label)', cursor: 'move', padding: 2, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>{frame.name}</button>
                  <span style={{ color: 'var(--text-hint)' }}>{frame.width} × {frame.height}</span>
                </div>
                <div style={{ width: '100%', height: rect.height }}>
                  <DesignFramePreview frame={visible} active={frame.id === selectedFrame} bridge={bridge} onSelect={selection => { if (dirtyRef.current) return; if (selectedFrame !== frame.id) chooseFrame(frame.id); setSelectedElement(selection); }} onMarkup={html => directMarkup(frame.id, html)} />
                </div>
                <button aria-label={`Resize ${frame.name}`} title="Resize frame" onPointerDown={event => startDrag(event, 'resize', frame)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); const rect = resizeRect(frame, event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0, event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0); void mutate([{ type: 'frame.update', frameId: frame.id, patch: { width: rect.width, height: rect.height } }]); } }} style={{ position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, padding: 0, border: 0, background: 'var(--accent-mint)', clipPath: 'polygon(100% 0,100% 100%,0 100%)', cursor: 'nwse-resize' }} />
              </div>;
            })}
          </div>
        </div>
        <aside aria-label="Design inspector" style={{ width: 218, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid var(--line-divider)', padding: 7, boxSizing: 'border-box' }}>
          <nav aria-label="Inspector sections" style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>{(['inspect', 'html', 'feedback', 'history'] as const).map(item => <Button key={item} aria-pressed={tab === item} onClick={() => setTab(item)} style={{ padding: '4px 5px', borderColor: tab === item ? 'var(--accent-mint)' : undefined }}>{item}</Button>)}</nav>
          {tab === 'inspect' ? <>
            <strong>{activeFrame?.name ?? 'Select a frame'}</strong>
            {activeFrame ? <>
              <label style={{ display: 'block', marginTop: 9 }}>Frame name<input aria-label="Frame name" style={{ ...input, marginTop: 4 }} value={activeFrame.name} onChange={event => { const value = event.target.value; setDocument(current => current ? { ...current, frames: current.frames.map(item => item.id === activeFrame.id ? { ...item, name: value } : item) } : current); }} onBlur={event => { if (event.target.value.trim()) void mutate([{ type: 'frame.update', frameId: activeFrame.id, patch: { name: event.target.value.trim() } }]); }} /></label>
              <div style={{ marginTop: 8, color: 'var(--text-hint)' }}>Position {Math.round(activeFrame.x)}, {Math.round(activeFrame.y)}</div><div style={{ color: 'var(--text-hint)' }}>Size {activeFrame.width} × {activeFrame.height}</div>
              {document.workingFrameId === activeFrame.id ? <p style={{ color: 'var(--accent-mint)' }}>Chosen working direction</p> : null}
            </> : null}
            <hr style={{ border: 0, borderTop: '1px solid var(--line-divider)', margin: '10px 0' }} />
            <datalist id="design-style-colors">{COLOR_CHOICES.map(value => <option key={value} value={value} />)}</datalist>
            {selectedElement ? <>
              <strong>{selectedElement.tag}</strong><div style={{ color: 'var(--text-hint)', margin: '4px 0' }}>Selected element</div>
              <label>Text (leaf elements only)<textarea aria-label="Selected element text" disabled={!selectedElement.leaf} value={selectedElement.text} onChange={event => setSelectedElement({ ...selectedElement, text: event.target.value.slice(0, 500) })} style={{ ...textArea, minHeight: 55 }} /></label>
              <Button disabled={!selectedElement.leaf || saving} onClick={sendText} style={{ margin: '5px 0 9px' }}>Apply text</Button>
              {(['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'gap', 'borderRadius', 'display', 'flexDirection', 'alignItems', 'justifyContent'] as const).map(property => <label key={`${selectedElement.id}:${property}`} style={{ display: 'block', marginBottom: 6 }}>{property}<input aria-label={`Selected element ${property}`} list={property === 'color' || property === 'backgroundColor' ? 'design-style-colors' : undefined} disabled={saving || sourceDirty} style={{ ...input, marginTop: 3 }} defaultValue={selectedElement.styles[property] ?? ''} onBlur={event => { const value = event.target.value; if (value) sendStyle(property, value); }} /></label>)}
              <Button onClick={() => addElement('text')}>Add text</Button> <Button onClick={() => addElement('button')}>Add button</Button> <Button onClick={() => addElement('container')}>Add container</Button>
            </> : <div style={{ color: 'var(--text-hint)' }}>Select an element in the preview to inspect and edit it.</div>}
          </> : null}
          {tab === 'html' ? <>
            <div style={{ marginBottom: 5, color: sourceDirty ? 'var(--accent-amber)' : 'var(--text-hint)' }}>{sourceDirty ? 'Unsaved source draft' : 'HTML body (scripts and JSX are not executed)'}</div>
            <textarea aria-label="Frame HTML source" spellCheck={false} value={sourceHtml} onChange={event => updateSource('html', event.target.value)} style={{ ...textArea, height: 220 }} />
            <label style={{ display: 'block', marginTop: 7 }}>CSS<textarea aria-label="Frame CSS source" spellCheck={false} value={sourceStyles} onChange={event => updateSource('styles', event.target.value)} style={{ ...textArea, height: 150 }} /></label>
            <div style={{ display: 'flex', gap: 5, marginTop: 6 }}><Button disabled={!sourceDirty || saving} onClick={saveSource}>Save source</Button><Button disabled={!sourceDirty} onClick={() => { dirtyRef.current = false; setSourceDirty(false); if (activeFrame) { setSourceHtml(activeFrame.html); setSourceStyles(activeFrame.styles); } }}>Discard</Button></div>
          </> : null}
          {tab === 'feedback' ? <>
            <label>Feedback<textarea aria-label="Frame feedback" value={feedback} onChange={event => setFeedback(event.target.value)} style={{ ...textArea, minHeight: 90, marginTop: 5 }} placeholder="Describe a change for the agent…" /></label>
            <Button disabled={!feedback.trim() || saving} onClick={createComment} style={{ margin: '5px 0 9px' }}>Save feedback</Button>
            {selectedComments.map(comment => <article key={comment.id} style={{ borderTop: '1px solid var(--line-divider)', padding: '7px 0' }}>
              <div>{comment.text}</div><small style={{ color: 'var(--text-hint)' }}>{comment.frameId ? document.frames.find(frame => frame.id === comment.frameId)?.name ?? 'Deleted frame' : 'Board feedback'} · {comment.resolved ? 'resolved' : 'open'}</small>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}><Button onClick={() => pushToComposer(session, { text: `Design feedback for board “${slug}”, ${comment.frameId ? `frame ${document.frames.find(frame => frame.id === comment.frameId)?.name ?? comment.frameId}` : 'the board'}${comment.element ? `, element ${comment.element}` : ''}: ${comment.text}` })}>Add to chat</Button><Button onClick={() => void mutate([{ type: 'comment.resolve', commentId: comment.id, resolved: !comment.resolved }])}>{comment.resolved ? 'Reopen' : 'Resolve'}</Button><Button onClick={() => void mutate([{ type: 'comment.remove', commentId: comment.id }])}>Remove</Button></div>
            </article>)}
          </> : null}
          {tab === 'history' ? <>
            <div style={{ color: 'var(--text-hint)', marginBottom: 6 }}>Restore points (newest first)</div>
            {[...history].reverse().map(item => <div key={item.revision} style={{ borderTop: '1px solid var(--line-divider)', padding: '7px 0' }}><div>r{item.revision} · {item.summary}</div><small style={{ color: 'var(--text-hint)' }}>{new Date(item.at).toLocaleString()}</small><div><Button disabled={saving} onClick={() => void restore(item.revision)}>Restore</Button></div></div>)}
          </> : null}
        </aside>
      </div>
      <footer style={{ minHeight: 25, flexShrink: 0, padding: '4px 8px', borderTop: '1px solid var(--line-divider)', display: 'flex', alignItems: 'center', gap: 8, color: error ? 'var(--accent-red)' : remoteRevision ? 'var(--accent-amber)' : 'var(--text-hint)' }}>
        <span role={error ? 'alert' : 'status'}>{error || (remoteRevision ? `Board changed remotely to r${remoteRevision}; unsaved text is preserved. Reload to reconcile.` : sourceDirty ? 'Unsaved editor text' : `${document.frames.length} frames · changes are revision-checked`)}</span>
        {(remoteRevision || error.startsWith('design.conflict:')) && !sourceDirty ? <Button onClick={() => void reloadCurrent()}>Reload changes</Button> : null}
      </footer>
      {expanded && composerSlot ? <div style={{ flexShrink: 0, borderTop: '1px solid var(--line-divider)' }}>{composerSlot}</div> : null}
    </>}
  </div>;

  async function restore(targetRevision: number): Promise<void> {
    const current = board.current; const currentSlug = slugRef.current; const token = generation.current;
    if (!current || !currentSlug || savingRef.current) return;
    if (dirtyRef.current) { setError('Save or discard the unsaved HTML before restoring history.'); return; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await transport.request('design.restore', { session, slug: currentSlug, expectedRevision: current.revision, targetRevision });
      if (token !== generation.current) return;
      if (response.type === 'err') { setError(`${response.code}: ${response.message}`); return; }
      setCurrent(response.body as Result); setSelectedElement(null); dirtyRef.current = false; setSourceDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) { savingRef.current = false; setSaving(false); } }
  }
}

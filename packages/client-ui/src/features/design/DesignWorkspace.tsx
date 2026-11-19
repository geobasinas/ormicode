import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { ChevronDown, FolderGit2, Frame, Monitor, PanelRight, PanelsTopLeft, Plus, RefreshCw, Smartphone, SquarePlus, X } from 'lucide-react';
import { pushToComposer } from '../../lib/composer-inbox.ts';
import { usePlatform } from '../../lib/platform.ts';
import type { DesignDocument, DesignFrame, DesignOperation, DesignHistorySummary } from '@ormicode/protocol';
import { DesignFramePreview, type ElementSelection } from './DesignFramePreview.tsx';
import { DesignCanvas, type CanvasTool } from './DesignCanvas.tsx';
import { DesignInspector, type InspectorTab } from './DesignInspector.tsx';
import { DesignLayers } from './DesignLayers.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { sanitizeMarkup } from './sanitize.ts';
import { clampPosition, fitCanvas, reconcileFrameSelection, resizeRect, zoomAt, type Rect, type View } from './design-model.ts';
import { validateStyleEdit } from './design-style.ts';
import { useDesignDrag } from './useDesignDrag.ts';

type BoardSummary = { slug: string; name: string; revision: number; frames: number };
type Result = { document: DesignDocument; history: DesignHistorySummary[] };
type Props = { session: string; project: string; workspacePath: string; sessionError: string; sidebarOpen: boolean; onShowSidebar(): void; agentSlot: ReactNode };

const startHtml = '<main style="min-height:100%;padding:32px;font-family:Inter,system-ui,sans-serif;color:var(--text-title);background:var(--bg-main)"><h1>Start designing</h1><p>Select this text to edit it, or add an element from the toolbar.</p></main>';

export function DesignWorkspace({ session, project, workspacePath, sessionError, sidebarOpen, onShowSidebar, agentSlot }: Props) {
  const { transport } = usePlatform();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [slug, setSlug] = useState('');
  const [document, setDocument] = useState<DesignDocument | null>(null);
  const [history, setHistory] = useState<DesignHistorySummary[]>([]);
  const [selectedFrame, setSelectedFrame] = useState('');
  const [selectedElement, setSelectedElement] = useState<ElementSelection | null>(null);
  const [tab, setTab] = useState<InspectorTab>('inspect');
  const [inspectorOpen, setInspectorOpen] = useState(() => !window.matchMedia('(max-width: 850px)').matches);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [selectionRequest, setSelectionRequest] = useState<{ frameId: string; path: string }>();
  const [sourceHtml, setSourceHtml] = useState('');
  const [sourceStyles, setSourceStyles] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
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
    setSelectionRequest(undefined);
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
    setHistory([]); setError(''); dirtyRef.current = false; setSourceDirty(false); setRemoteRevision(null); fittedSlug.current = ''; savingRef.current = false; setSaving(false); setLoading(true);
    void transport.request('design.list', { session }).then(response => {
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      const items = (response.body as { boards: BoardSummary[] }).boards;
      setBoards(items);
      if (items[0]) void readBoard(items[0].slug);
      else setLoading(false);
    }).catch(reason => { if (token === generation.current) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } });
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
    const title = newName.trim();
    const cleanSlug = newSlug.trim() || title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(cleanSlug) || !title) { setError('Use a lowercase board slug and a non-empty name.'); return; }
    setLoading(true); setError('');
    try {
      const response = await transport.request('design.create', { session, slug: cleanSlug, name: title });
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      setNewSlug(''); setNewName(''); setCreateOpen(false); setBoards(items => [...items.filter(item => item.slug !== cleanSlug), { slug: cleanSlug, name: title, revision: 1, frames: 0 }].sort((a, b) => a.slug.localeCompare(b.slug)));
      void readBoard(cleanSlug, true);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) setLoading(false); }
  };

  const activeFrame = document?.frames.find(frame => frame.id === selectedFrame);
  const previewFrame = activeFrame && sourceDirty ? { ...activeFrame, html: sourceHtml, styles: sourceStyles } : activeFrame;
  const updateSource = (field: 'html' | 'styles', value: string) => {
    if (value.length > (field === 'html' ? 24576 : 16384)) { setError(`${field} exceeds its size limit.`); return; }
    if (field === 'html') setSourceHtml(value); else setSourceStyles(value);
    dirtyRef.current = true; setSourceDirty(true); setError('');
  };
  const chooseFrame = (id: string, current = document) => {
    if (dirtyRef.current) { setError('Save or discard the unsaved HTML before switching frames.'); return false; }
    if (id === selectedFrameRef.current) bridge.current('clearSelection');
    selectedFrameRef.current = id;
    setSelectionRequest(undefined);
    setSelectedFrame(id); setSelectedElement(null);
    const frame = current?.frames.find(item => item.id === id);
    setSourceHtml(frame?.html ?? ''); setSourceStyles(frame?.styles ?? '');
    return true;
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
    const x = index ? clampPosition(Math.max(...document.frames.map(frame => frame.x + frame.width)) + 64) : 0;
    const y = index ? Math.min(...document.frames.map(frame => frame.y)) : 0;
    const frame = { name: `${kind === 'phone' ? 'Phone' : kind === 'desktop' ? 'Desktop' : 'Blank'} ${index + 1}`, x, y, width, height, html: kind === 'blank' ? '<main style="min-height:100%;padding:24px"></main>' : startHtml, styles: '' };
    void mutate([{ type: 'frame.add', ...frame }]).then(ok => {
      const current = board.current;
      const added = current?.frames.at(-1);
      if (ok && current && added) { chooseFrame(added.id, current); setView(fitCanvas(current.frames, canvasSize.width, canvasSize.height)); }
    });
  };

  const drag = useDesignDrag({ board, view, setView, panTool: tool === 'pan', chooseFrame,
    canDrag: () => !savingRef.current,
    onCommit: operation => void mutate([operation]),
    onConflict: () => setError('The board changed during the drag. Try again.'),
  });
  const frameRect = (frame: DesignFrame): Rect => drag.preview?.id === frame.id ? drag.preview.rect : frame;

  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => setCanvasSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    if (event.ctrlKey || event.metaKey) setView(current => zoomAt(current, { x: event.clientX - box.left, y: event.clientY - box.top }, Math.exp(-event.deltaY * 0.002)));
    else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }, []);
  useEffect(() => {
    if (document?.frames.length && slug && fittedSlug.current !== slug && canvasSize.width > 0 && canvasSize.height > 0) {
      fittedSlug.current = slug;
      setView(fitCanvas(document.frames, canvasSize.width, canvasSize.height));
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

  const frames = document?.frames ?? [];
  const status = error || sessionError || (remoteRevision ? 'A newer revision is available.' : sourceDirty ? 'Unsaved source' : saving ? 'Saving…' : document ? 'Saved · r' + document.revision : '');
  const failure = Boolean(error || sessionError);
  const canReload = (remoteRevision || error.startsWith('design.conflict:') || (!document && slug)) && !sourceDirty;
  const fit = (items = frames) => setView(fitCanvas(items, canvasSize.width, canvasSize.height));
  const insertFrame = <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="design-button primary" disabled={!document || saving || sourceDirty}><Plus size={15} /><span>Add frame</span><ChevronDown size={12} /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => addFrame('phone')}><Smartphone size={15} /> Phone frame</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => addFrame('desktop')}><Monitor size={15} /> Desktop frame</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => addFrame('blank')}><Frame size={15} /> Blank frame</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;

  return <main aria-label="Design workspace" className="design-workspace" data-sidebar={sidebarOpen} data-inspector={inspectorOpen}>
    <aside hidden={!sidebarOpen} className="design-sidebar design-pane" aria-label="Design sidebar">
      <div className="design-pane-toolbar design-project" title={workspacePath}><FolderGit2 size={16} /><strong>{project}</strong></div>
      <section className="design-boards" aria-label="Design boards">
        <div className="design-section-heading"><span>Boards</span><button type="button" className="design-icon-button" aria-label="New board" title="New board" onClick={() => setCreateOpen(true)}><Plus size={15} /></button></div>
        <div className="design-board-list">{boards.map(item => <button type="button" key={item.slug} className="design-layer-name design-board-row" aria-pressed={item.slug === slug} onClick={() => { if (item.slug !== slug) void readBoard(item.slug); }}>
          <PanelsTopLeft size={14} /><span>{item.name}</span>
        </button>)}</div>
      </section>
      <DesignLayers frames={frames} activeFrame={previewFrame} activePath={selectedElement?.path} workingFrame={document?.workingFrameId}
        onFrame={chooseFrame} onReveal={frame => { if (chooseFrame(frame.id)) fit([frame]); }} onElement={(frameId, path) => {
          if (!chooseFrame(frameId)) return;
          setSelectionRequest({ frameId, path });
          setTab('inspect'); setInspectorOpen(true);
        }} />
      {agentSlot}
    </aside>
    <section className="design-main" aria-label="Board editor">
      <header className="design-canvas-header">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="design-board-picker" aria-label="Design board"><PanelsTopLeft size={16} /><strong>{document?.name ?? boards.find(item => item.slug === slug)?.name ?? 'Boards'}</strong><ChevronDown size={13} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {boards.map(item => <DropdownMenuItem key={item.slug} onSelect={() => { if (item.slug !== slug) void readBoard(item.slug); }}>{item.name}</DropdownMenuItem>)}
            {boards.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}><Plus size={15} /> New board</DropdownMenuItem>
            {slug ? <DropdownMenuItem disabled={loading || saving || sourceDirty} onSelect={() => void reloadCurrent()}><RefreshCw size={14} /> Reload board</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="design-header-space" />
        {document && !failure && !remoteRevision ? <span className="design-status" data-dirty={sourceDirty || saving} role="status"><i />{status}</span> : null}
        {document ? insertFrame : null}
        <button type="button" className="design-icon-button design-inspector-toggle" title="Toggle inspector" aria-label="Toggle inspector" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(shown => !shown)}><PanelRight size={17} /></button>
      </header>
      {failure || remoteRevision ? <div className="design-alert" role={failure ? 'alert' : 'status'}><span>{status}</span>
        {canReload ? <button className="design-button" type="button" onClick={() => void reloadCurrent()}>Reload changes</button> : null}
        <button type="button" className="design-icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setRemoteRevision(null); }}><X size={14} /></button>
      </div> : null}
      {createOpen ? <form className="design-create" onSubmit={event => { event.preventDefault(); void createBoard(); }}>
        <input className="design-input" aria-label="New board name" placeholder="Board name" autoFocus maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} />
        <input className="design-input" aria-label="New board slug" placeholder="Folder name" maxLength={48} value={newSlug} onChange={event => setNewSlug(event.target.value)} />
        <button type="submit" className="design-button primary" disabled={loading || saving || !newName.trim()}>Create board</button>
        <button type="button" className="design-icon-button" aria-label="Cancel creation" onClick={() => setCreateOpen(false)}><X size={15} /></button>
      </form> : null}
      <DesignCanvas canvas={canvas} frames={frames} selectedFrame={selectedFrame} view={view} tool={tool} panning={drag.panning} onTool={setTool}
        frameRect={frameRect} guides={drag.preview?.guides} onDrag={drag.startDrag} onPointerDown={drag.startPan} onPointerMove={drag.move} onPointerUp={drag.end}
        onPointerCancel={drag.cancel} onWheel={handleWheel}
        onNudge={(frame, kind, dx, dy) => {
          const rect = resizeRect(frame, dx, dy);
          const patch = kind === 'resize' ? { width: rect.width, height: rect.height } : { x: clampPosition(frame.x + dx), y: clampPosition(frame.y + dy) };
          void mutate([{ type: 'frame.update', frameId: frame.id, patch }]);
        }} onZoom={zoom} onFit={() => fit()} onFitSelection={activeFrame ? () => fit([activeFrame]) : undefined}
        preview={frame => <DesignFramePreview frame={previewFrame?.id === frame.id ? previewFrame : frame} active={frame.id === selectedFrame} bridge={bridge}
          selectionRequest={selectionRequest?.frameId === frame.id ? selectionRequest : undefined}
          onReset={() => { if (selectedFrameRef.current === frame.id) setSelectedElement(null); }}
          onSelect={selection => {
            if (dirtyRef.current) return;
            if (selectedFrameRef.current !== frame.id && !chooseFrame(frame.id)) return;
            setSelectedElement(selection);
            setTab(current => current === 'html' ? 'inspect' : current);
            setInspectorOpen(true);
          }} onMarkup={html => directMarkup(frame.id, html)} />}
        insert={activeFrame ? <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="design-icon-button" title="Insert element" aria-label="Insert element" disabled={saving || sourceDirty}><SquarePlus size={16} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => addElement('text')}>Text</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addElement('button')}>Button</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addElement('container')}>Container</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : null}
        empty={!frames.length ? <div className="design-empty-stage"><div className="design-empty">
          <div className="design-empty-icon"><PanelsTopLeft size={24} /></div>
          <h1>{loading ? 'Loading board…' : document ? 'Add your first frame' : slug ? 'Board unavailable' : 'Start a design board'}</h1>
          {!loading && document ? <><p>Add a screen to the canvas to start designing.</p>{insertFrame}</> : null}
          {!loading && !document && !slug ? <><p>Keep your screens and iterations together in this project.</p><button type="button" className="design-button primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New board</button></> : null}
        </div></div> : null} />
    </section>
    {inspectorOpen ? <DesignInspector tab={tab} onTab={setTab} document={document} activeFrame={activeFrame} selectedElement={selectedElement}
      onElementText={text => setSelectedElement(current => current ? { ...current, text } : null)} onSaveText={sendText} onStyle={sendStyle}
      sourceHtml={sourceHtml} sourceStyles={sourceStyles} sourceDirty={sourceDirty} onSource={updateSource} onSaveSource={saveSource}
      onDiscardSource={() => { dirtyRef.current = false; setSourceDirty(false); setSourceHtml(activeFrame?.html ?? ''); setSourceStyles(activeFrame?.styles ?? ''); }}
      history={history} onRestore={revision => void restore(revision)} feedback={feedback} onFeedback={setFeedback} onAddComment={createComment}
      onChat={text => { onShowSidebar(); pushToComposer(session, { text }); }} onMutate={operations => void mutate(operations)} saving={saving} /> : null}
  </main>;

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

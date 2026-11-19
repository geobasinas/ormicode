import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { FolderGit2, PanelsTopLeft, Plus } from 'lucide-react';
import { pushToComposer } from '../../lib/composer-inbox.ts';
import { usePlatform } from '../../lib/platform.ts';
import { designTokenBinding, styleRule, type DesignDocument, type DesignFrame, type DesignOperation, type DesignHistorySummary } from '@ormicode/protocol';
import { DesignFramePreview, type ElementSelection, type PreviewSource } from './DesignFramePreview.tsx';
import { DesignCanvas, type CanvasTool } from './DesignCanvas.tsx';
import { DesignInspector, type InspectorTab } from './DesignInspector.tsx';
import { DesignLayers } from './DesignLayers.tsx';
import { sanitizeMarkup } from './sanitize.ts';
import { clampPosition, fitCanvas, reconcileFrameSelection, type Rect } from './design-model.ts';
import { useDesignElementCommands } from './useDesignElementCommands.ts';
import { frameMarkupWithToken, renderDesignTokenStyles } from './design-inspector-model.ts';
import { downloadDesignLayer } from './design-layer-export.ts';
import { useDesignDrag } from './useDesignDrag.ts';
import { acceptsDesignRevision, sourceMatches } from './design-live.ts';
import { useDesignLive } from './useDesignLive.ts';
import type { DesignAgentContext } from './design-agent-context.ts';
import { useDesignPages } from './useDesignPages.ts';
import { framesOnPage } from './design-pages.ts';
import { DesignPagePicker } from './DesignPagePicker.tsx';
import { DesignViewportOverlay, useViewportOptions } from './DesignViewportOverlay.tsx';
import { useDesignFrames } from './frames/useDesignFrames.ts';
import { useFrameHistory } from './frames/useFrameHistory.ts';
import { FrameOverlay } from './frames/FrameOverlay.tsx';
import { FrameToolbar } from './frames/FrameToolbar.tsx';
import { FrameLayerControls } from './frames/FrameLayerControls.tsx';
import { useDesignArtwork } from './useDesignArtwork.tsx';
import { useDesignReview } from './review/useDesignReview.ts';
import { DesignReviewPanel } from './review/DesignReviewPanel.tsx';
import { DesignAnnotations } from './review/DesignAnnotations.tsx';
import { DesignFrameApproval } from './review/DesignFrameApproval.tsx';
import { DesignFrameVersions } from './review/DesignFrameVersions.tsx';
import type { ReviewComment } from './review/review-model.ts';
import { useCanvasViewport, useFitOnPageChange } from './useCanvasViewport.ts';
import { DesignBoardHeader } from './DesignBoardHeader.tsx';
import { InsertElementMenu, InsertFrameMenu } from './DesignInsertMenus.tsx';

type BoardSummary = { slug: string; name: string; revision: number; frames: number };
type Result = { document: DesignDocument; history: DesignHistorySummary[] };
type Props = { session: string; project: string; workspacePath: string; sessionError: string; sidebarOpen: boolean; onShowSidebar(): void; agentSlot(board: DesignAgentContext | undefined, sourceDirty: boolean): ReactNode };

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
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { canvas, view, setView, canvasSize, handleWheel, zoom } = useCanvasViewport();
  const board = useRef<DesignDocument | null>(null);
  const selectedFrameRef = useRef('');
  selectedFrameRef.current = selectedFrame;
  const slugRef = useRef('');
  const dirtyRef = useRef(false);
  const draftBase = useRef<DesignFrame | undefined>(undefined);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const fittedSlug = useRef('');
  const bridge: MutableRefObject<(type: string, body?: Record<string, unknown>) => void> = useRef(() => undefined);
  const frameHistory = useFrameHistory();
  useEffect(() => frameHistory.clear(), [session, slug, frameHistory.clear]);

  const setCurrent = useCallback((next: Result, token: number) => {
    if (!acceptsDesignRevision(board.current, next.document, token === generation.current)) return;
    board.current = next.document;
    setDocument(next.document);
    setHistory(next.history);
    setBoards(current => current.map(item => item.slug === slugRef.current ? { ...item, name: next.document.name, revision: next.document.revision, frames: next.document.frames.length } : item));
    const selected = dirtyRef.current ? selectedFrameRef.current : reconcileFrameSelection(next.document.frames, selectedFrameRef.current);
    if (selected !== selectedFrameRef.current) {
      selectedFrameRef.current = selected; setSelectedFrame(selected); setSelectedElement(null); setSelectionRequest(undefined);
    }
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
    dirtyRef.current = false; draftBase.current = undefined; setSourceDirty(false);
    setLoading(true); setError(''); setSlug(target); slugRef.current = target; setDocument(null); board.current = null;
    setSelectedElement(null);
    try {
      const response = await transport.request('design.get', { session, slug: target });
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      const result = response.body as Result;
      setCurrent(result, token);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) setLoading(false); }
  }, [session, transport, setCurrent]);

  useEffect(() => {
    const token = ++generation.current;
    setBoards([]); setSlug(''); slugRef.current = ''; setDocument(null); board.current = null; setSelectedFrame('');
    setHistory([]); setError(''); dirtyRef.current = false; draftBase.current = undefined; setSourceDirty(false); fittedSlug.current = ''; savingRef.current = false; setSaving(false); setLoading(true);
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
    const target = slugRef.current;
    const token = generation.current;
    if (!target) return;
    try {
      const response = await transport.request('design.get', { session, slug: target });
      if (token !== generation.current) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      setCurrent(response.body as Result, token);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [transport, session, setCurrent]);

  useDesignLive(transport, session, useCallback(async revisions => {
    const token = generation.current;
    const list = transport.request('design.list', { session }).then(response => {
      if (token !== generation.current || response.type !== 'res') return;
      const items = (response.body as { boards: BoardSummary[] }).boards;
      setBoards(current => items.map(item => current.find(previous => previous.slug === item.slug && previous.revision > item.revision) ?? item));
    });
    await Promise.allSettled([list, (revisions.get(slugRef.current) ?? 0) > (board.current?.revision ?? 0) ? reloadCurrent() : undefined]);
  }, [session, transport, reloadCurrent]));

  const mutate = useCallback(async (operations: DesignOperation[], options?: { record?: boolean }) => {
    const current = board.current; const currentSlug = slugRef.current; const token = generation.current;
    if (!current || !currentSlug || savingRef.current) return false;
    const sourceSave = dirtyRef.current && operations.length === 1 && operations[0].type === 'frame.update' && operations[0].frameId === selectedFrame && (operations[0].patch.html !== undefined || operations[0].patch.styles !== undefined);
    if (dirtyRef.current && !sourceSave) { setError('Save or discard the unsaved HTML before changing the board.'); return false; }
    if (sourceSave && !sourceMatches(current.frames.find(frame => frame.id === selectedFrame), draftBase.current)) return false;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await transport.request('design.update', { session, slug: currentSlug, expectedRevision: current.revision, operations });
      if (token !== generation.current) return false;
      if (response.type === 'err') {
        setError(`${response.code}: ${response.message}`);
        if (response.code === 'design.conflict') void reloadCurrent();
        return false;
      }
      const result = response.body as Result;
      if (options?.record !== false) frameHistory.record(current, result.document, operations);
      if (sourceSave) {
        dirtyRef.current = false; draftBase.current = undefined; setSourceDirty(false);
      }
      setCurrent(result, token);
      if (sourceSave && board.current) chooseFrame(reconcileFrameSelection(board.current.frames, selectedFrameRef.current), board.current);
      return result;
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { if (token === generation.current) { savingRef.current = false; setSaving(false); } }
  }, [session, transport, setCurrent, reloadCurrent, selectedFrame, frameHistory.record]);
  const review = useDesignReview(session, slug, async operations => Boolean(await mutate(operations)));

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

  const pages = useDesignPages(document, session + ':' + slug, mutate);
  const frames = pages.frames;
  const visibleFrames = frames.filter(frame => !frame.hidden);
  const viewport = useViewportOptions();
  useEffect(() => { const id = reconcileFrameSelection(frames, selectedFrameRef.current); if (id !== selectedFrameRef.current && !dirtyRef.current) chooseFrame(id); }, [document, pages.active.id]);
  const activeFrame = frames.find(frame => frame.id === selectedFrame);
  const sourceConflict = sourceDirty && !sourceMatches(activeFrame, draftBase.current);
  const previewFrame = activeFrame && sourceDirty ? { ...activeFrame, html: sourceHtml, styles: sourceStyles } : activeFrame;
  const updateSource = (field: 'html' | 'styles', value: string) => {
    if (value.length > (field === 'html' ? 24576 : 16384)) { setError(`${field} exceeds its size limit.`); return; }
    if (!dirtyRef.current) draftBase.current = activeFrame;
    if (field === 'html') setSourceHtml(value); else setSourceStyles(value);
    dirtyRef.current = true; setSourceDirty(true); setError('');
  };
  const chooseFrame = (id: string, current = board.current) => {
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
  const directMarkup = (id: string, html: string, source: PreviewSource) => {
    const token = generation.current;
    const base = board.current?.frames.find(frame => frame.id === id);
    if (!base || base.locked || dirtyRef.current || selectedFrameRef.current !== id) return;
    const draft = { ...base, ...source };
    const save = sourceMatches(base, draft) ? mutate([{ type: 'frame.update', frameId: id, patch: { html } }]) : Promise.resolve(false);
    void save.then(ok => {
      if (!ok && base && token === generation.current && selectedFrameRef.current === id) {
        dirtyRef.current = true; draftBase.current = draft; setSourceDirty(true); setSourceHtml(html); setSourceStyles(draft.styles); setTab('html');
      }
    });
  };
  const addFrame = (kind: 'desktop' | 'phone' | 'blank') => {
    if (!document) return;
    const index = frames.length;
    const width = kind === 'phone' ? 390 : kind === 'desktop' ? 1440 : 900;
    const height = kind === 'phone' ? 844 : kind === 'desktop' ? 900 : 650;
    const x = index ? clampPosition(Math.max(...frames.map(frame => frame.x + frame.width)) + 64) : 0;
    const y = index ? Math.min(...frames.map(frame => frame.y)) : 0;
    const frame = { name: `${kind === 'phone' ? 'Phone' : kind === 'desktop' ? 'Desktop' : 'Blank'} ${index + 1}`, x, y, width, height, html: kind === 'blank' ? '<main style="min-height:100%;padding:24px"></main>' : startHtml, styles: '' };
    void mutate([{ type: 'frame.add', ...frame, pageId: pages.active.id }]).then(result => {
      const current = board.current;
      const added = result && result.document.frames.at(-1);
      if (current && added && current.frames.some(item => item.id === added.id)) { chooseFrame(added.id, current); setView(fitCanvas(framesOnPage(current.frames, pages.active.id).filter(frame => !frame.hidden), canvasSize.width, canvasSize.height)); }
    });
  };

  const openThread = (comment: ReviewComment) => {
    if (dirtyRef.current) return;
    const frame = document?.frames.find(item => item.id === comment.frameId);
    if (frame || comment.pageId) {
      const pageId = frame?.pageId ?? comment.pageId ?? 'default';
      fittedSlug.current = slug + '/' + pageId;
      pages.select(pageId);
    }
    if (frame) { chooseFrame(frame.id); setView(fitCanvas([frame], canvasSize.width, canvasSize.height)); }
    if (comment.frameId && comment.path) setSelectionRequest({ frameId: comment.frameId, path: comment.path });
    review.setThread(comment.id); setTab('feedback'); setInspectorOpen(true);
  };
  const drag = useDesignDrag({ board, view, setView, panTool: tool === 'pan', commentTool: tool === 'comment', chooseFrame,
    pageFilter: frame => (frame.pageId ?? 'default') === pages.active.id, snapLines: () => viewport.options.guides ? pages.active.guides ?? [] : [],
    canDrag: () => !savingRef.current,
    onCommit: operation => void mutate([operation]),
    onConflict: () => setError('The board changed during the drag. Try again.'),
  });
  const frameOps = useDesignFrames({ board, frames, pageId: pages.active.id, snapLines: () => viewport.options.guides ? pages.active.guides ?? [] : [], primary: selectedFrame, chooseFrame, canvas, view, canvasSize, mutate, history: frameHistory,
    canEdit: () => !savingRef.current && !dirtyRef.current, onError: setError });
  const frameRect = (frame: DesignFrame): Rect & { rotation?: number } => frameOps.previewRect(frame) ?? (drag.preview?.id === frame.id ? drag.preview.rect : frame);

  useFitOnPageChange(document ? slug + '/' + pages.active.id : '', fittedSlug, visibleFrames, canvasSize, setView);

  const selectedElementRef = useRef<ElementSelection | null>(null);
  selectedElementRef.current = selectedElement;
  const editable = Boolean(activeFrame && !activeFrame.locked && !saving && !sourceDirty);
  const elementCommands = useDesignElementCommands(activeFrame, selectedElement, editable, session + ':' + slug, bridge, setError);
  const tokenStyles = renderDesignTokenStyles(document?.tokens);
  const artwork = useDesignArtwork({
    owner: document, scope: JSON.stringify([session, slug, pages.active.id]), frame: activeFrame, enabled: Boolean(document && !saving && !sourceDirty),
    view, size: canvasSize, onError: setError,
    onCommit: async operation => {
      if (board.current !== document || slugRef.current !== slug || dirtyRef.current || savingRef.current) return false;
      if (operation.type === 'frame.add' && !frames.length) fittedSlug.current = slug + '/' + pages.active.id;
      const result = await mutate([operation.type === 'frame.add' ? { ...operation, pageId: pages.active.id } : operation]);
      if (!result) return false;
      const added = operation.type === 'frame.add' && result.document.frames.at(-1);
      if (added) chooseFrame(added.id, board.current);
      return true;
    },
  });
  const status = error || sessionError || (sourceConflict ? 'This frame’s source changed or was removed. Copy or discard your draft in HTML.' : sourceDirty ? 'Unsaved source' : saving ? 'Saving…' : document ? 'Saved · r' + document.revision : '');
  const failure = Boolean(error || sessionError || sourceConflict);
  const canReload = error.startsWith('design.conflict:') || (!document && slug);
  const fit = (items = visibleFrames) => setView(fitCanvas(items, canvasSize.width, canvasSize.height));
  const insertFrame = <InsertFrameMenu disabled={!document || saving || sourceDirty} addFrame={addFrame} />;
  return <main aria-label="Design workspace" className="design-workspace" data-sidebar={sidebarOpen} data-inspector={inspectorOpen}>
    <aside hidden={!sidebarOpen} className="design-sidebar design-pane" aria-label="Design sidebar">
      <div className="design-pane-toolbar design-project" title={workspacePath}><FolderGit2 size={16} /><strong>{project}</strong></div>
      <section className="design-boards" aria-label="Design boards">
        <div className="design-section-heading"><span>Boards</span><button type="button" className="design-icon-button" aria-label="New board" title="New board" onClick={() => setCreateOpen(true)}><Plus size={15} /></button></div>
        <div className="design-board-list">{boards.map(item => <button type="button" key={item.slug} className="design-layer-name design-board-row" aria-pressed={item.slug === slug} onClick={() => { if (item.slug !== slug) void readBoard(item.slug); }}>
          <PanelsTopLeft size={14} /><span>{item.name}</span>
        </button>)}</div>
      </section>
      {document && <DesignPagePicker pages={pages} selected={activeFrame} disabled={saving || sourceDirty} onSelect={id => { if (chooseFrame('')) pages.select(id); }} onStart={frame => { if (chooseFrame(frame.id)) { pages.select(frame.pageId ?? 'default'); fit([frame]); } }} />}
      <DesignLayers frames={frames} activeFrame={previewFrame} activePath={selectedElement?.path} workingFrame={document?.workingFrameId}
        selectedIds={frameOps.ids} onFrameClick={frameOps.layerClick} onReorder={frameOps.actions.reorder}
        frameControls={frame => <FrameLayerControls frame={frame} disabled={saving || sourceDirty} onToggle={frameOps.actions.toggle} />}
        onFrame={chooseFrame} onReveal={frame => { if (chooseFrame(frame.id)) fit([frame]); }} onElement={(frameId, path) => {
          if (!chooseFrame(frameId)) return;
          setSelectionRequest({ frameId, path });
          setTab('inspect'); setInspectorOpen(true);
        }} />
      {agentSlot(document ? { slug, name: document.name, revision: document.revision, frame: activeFrame } : undefined, sourceDirty)}
    </aside>
    <section className="design-main" aria-label="Board editor">
      <DesignBoardHeader boards={boards} name={document?.name} slug={slug} status={status} failure={failure} error={error} canReload={Boolean(canReload)}
        loading={loading} saving={saving} sourceDirty={sourceDirty} inspectorOpen={inspectorOpen} createOpen={createOpen}
        newName={newName} newSlug={newSlug} insertFrame={insertFrame} readBoard={readBoard} reloadCurrent={reloadCurrent}
        toggleInspector={() => setInspectorOpen(shown => !shown)} createBoard={createBoard}
        setCreateOpen={setCreateOpen} setError={setError} setNewName={setNewName} setNewSlug={setNewSlug} />
      <DesignCanvas canvas={canvas} frames={visibleFrames} selectedFrame={selectedFrame} selectedIds={frameOps.ids} view={view} tool={tool} panning={drag.panning} onTool={next => { artwork.clear(); setTool(next); }}
        drawing={artwork.overlay} drawingTools={artwork.toolbar}
        background={pages.active.background} startFrameId={pages.start?.id} viewportOverlay={<DesignViewportOverlay page={pages.active} view={view} {...canvasSize} preferences={viewport} disabled={!document || saving || sourceDirty} act={pages.act} />}
        frameRect={frameRect} guides={frameOps.gestures.guides.length ? frameOps.gestures.guides : drag.preview?.guides}
        onDrag={(event, kind, frame) => { if (tool !== 'select' || !frameOps.frameDrag(event, kind, frame)) drag.startDrag(event, kind, frame); }}
        onPointerDown={event => { if (tool === 'select' && event.button === 0 && event.target === event.currentTarget && !event.altKey) frameOps.gestures.startMarquee(event); else drag.startPan(event); }}
        onPointerMove={event => { if (!frameOps.gestures.move(event)) drag.move(event); }} onPointerUp={event => { if (!frameOps.gestures.end(event)) drag.end(event); }}
        onPointerCancel={event => { if (!frameOps.gestures.cancel(event)) drag.cancel(event); }} onWheel={handleWheel}
        overlay={<FrameOverlay frames={frameOps} />} annotation={document ? <DesignAnnotations document={document} frames={visibleFrames} pageId={pages.active.id} view={view} frameRect={frameRect} commenting={tool === 'comment' && !artwork.drawing} onThread={openThread}
          onCancel={() => { setTool('select'); review.setPending(null); }} onTarget={target => { review.begin(target); setTool('select'); setTab('feedback'); setInspectorOpen(true); }} /> : null} controls={document ? <FrameToolbar frames={frameOps} history={frameHistory} disabled={saving || sourceDirty} /> : null}
        onDrop={frameOps.drop} onDragOver={frameOps.dragOver}
        onNudge={frameOps.nudge} onZoom={zoom} onFit={() => fit()} onFitSelection={visibleFrames.some(frame => frameOps.ids.includes(frame.id)) ? () => fit(visibleFrames.filter(frame => frameOps.ids.includes(frame.id))) : undefined}
        preview={frame => <DesignFramePreview frame={previewFrame?.id === frame.id ? previewFrame : frame} active={frame.id === selectedFrame} bridge={bridge} tokenStyles={tokenStyles}
          editable={editable} interactive={tool === 'select' && !artwork.drawing} zoom={view.scale}
          onLayerExport={html => { if (selectedFrameRef.current === frame.id && !downloadDesignLayer(html, frame.name + ' layer')) setError('This layer could not be exported within the size limit.'); }}
          selectionRequest={selectionRequest?.frameId === frame.id ? selectionRequest : undefined}
          onReset={() => { if (selectedFrameRef.current === frame.id) setSelectedElement(null); }}
          onSelect={selection => {
            if (dirtyRef.current) return;
            if (selectedFrameRef.current !== frame.id && !chooseFrame(frame.id)) return;
            setSelectedElement(selection);
            setTab(current => current === 'html' ? 'inspect' : current);
            setInspectorOpen(true);
          }} onMarkup={(html, base) => directMarkup(frame.id, html, base)} />}
        insert={activeFrame ? <InsertElementMenu disabled={!editable || tool !== 'select' || artwork.drawing} addElement={elementCommands.add} addImage={elementCommands.addImage} /> : null}
        empty={!frames.length && !artwork.drawing ? <div className="design-empty-stage"><div className="design-empty">
          <div className="design-empty-icon"><PanelsTopLeft size={24} /></div>
          <h1>{loading ? 'Loading board…' : document ? 'Add your first frame' : slug ? 'Board unavailable' : 'Start a design board'}</h1>
          {!loading && document ? <><p>Add a screen to the canvas to start designing.</p>{insertFrame}</> : null}
          {!loading && !document && !slug ? <><p>Keep your screens and iterations together in this project.</p><button type="button" className="design-button primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New board</button></> : null}
        </div></div> : null} />
    </section>
    {inspectorOpen ? <DesignInspector tab={tab} onTab={setTab} document={document} activeFrame={activeFrame} selectedElement={selectedElement}
      approval={activeFrame ? <DesignFrameApproval frame={activeFrame} sessions={review.sessions} disabled={saving || sourceDirty} onApprove={status => void review.approve(activeFrame.id, status)} /> : null}
      versions={activeFrame && document ? <DesignFrameVersions session={session} slug={slug} revision={document.revision} frame={activeFrame} disabled={saving || sourceDirty} onRestore={revision => void review.restore(activeFrame.id, revision)} /> : null}
      review={document ? <DesignReviewPanel key={session + ':' + slug} document={document} review={review} disabled={saving || sourceDirty} onThread={openThread}
        target={review.pending ?? { frameId: activeFrame?.id ?? null, ...(selectedElement ? { path: selectedElement.path, element: selectedElement.tag } : {}) }}
        onChat={text => { onShowSidebar(); pushToComposer(session, { text }); }} /> : null}
      onElementText={text => setSelectedElement(current => current ? { ...current, text } : null)} onSaveText={elementCommands.text} onStyle={elementCommands.style} elementCommands={elementCommands}
      onAlign={(axis, alignment) => { if (selectedElement && !savingRef.current && !dirtyRef.current) bridge.current('alignElement', { id: selectedElement.id, axis, alignment }); }}
      onExportLayer={() => { if (selectedElement) bridge.current('exportLayer', { id: selectedElement.id }); }}
      onCreateToken={(property, token) => {
        if (!selectedElement || !activeFrame || styleRule(property).token !== token.kind || savingRef.current || dirtyRef.current) return;
        const html = frameMarkupWithToken(sanitizeMarkup(activeFrame.html), selectedElement.path, selectedElement.tag, property, designTokenBinding(token.name));
        if (html === undefined) { setError('Select the layer again to bind its new token.'); return; }
        const { id, path } = selectedElement;
        void mutate([{ type: 'token.set', token }, { type: 'frame.update', frameId: activeFrame.id, patch: { html } }]).then(ok => {
          const currentSelection = selectedElementRef.current;
          if (ok && selectedFrameRef.current === activeFrame.id && (!currentSelection || currentSelection.id === id)) setSelectionRequest({ frameId: activeFrame.id, path });
        });
      }}
      sourceHtml={sourceHtml} sourceStyles={sourceStyles} sourceDirty={sourceDirty} sourceConflict={sourceConflict} onSource={updateSource} onSaveSource={saveSource}
      onDiscardSource={() => { dirtyRef.current = false; draftBase.current = undefined; setSourceDirty(false); chooseFrame(reconcileFrameSelection(frames, selectedFrame)); setError(''); }}
      history={history} onRestore={revision => void restore(revision)}
      onChat={text => { onShowSidebar(); pushToComposer(session, { text }); }} onMutate={operations => void mutate(operations)} saving={saving} /> : null}
  </main>;

  async function restore(targetRevision: number): Promise<void> {
    const current = board.current; const currentSlug = slugRef.current; const token = generation.current;
    if (!current || !currentSlug || savingRef.current) return;
    if (dirtyRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await transport.request('design.restore', { session, slug: currentSlug, expectedRevision: current.revision, targetRevision });
      if (token !== generation.current) return;
      if (response.type === 'err') { setError(`${response.code}: ${response.message}`); if (response.code === 'design.conflict') void reloadCurrent(); return; }
      setCurrent(response.body as Result, token);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) { savingRef.current = false; setSaving(false); } }
  }
}

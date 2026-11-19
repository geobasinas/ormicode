import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { DesignDocument, DesignFrame, DesignOperation, DesignStackDirection } from '@ormicode/protocol';
import { sanitizeMarkup } from '../sanitize.ts';
import type { Rect, View } from '../design-model.ts';
import type { DragKind } from '../design-snap.ts';
import { clickSelection, editableFrame, expandGroups, previewFrames, selectedIds, setOperation, unionRect, moveFrames, type FrameSelection } from './frame-selection.ts';
import { droppedFrame, duplicateOperation, FRAME_CLIP_KEY, FRAME_CLIP_MIME, parseFrameClip, pasteOperation, serializeFrames } from './frame-clipboard.ts';
import { useFrameGestures, type FrameGestureKind } from './useFrameGestures.ts';
import type { FrameHistory } from './useFrameHistory.ts';

type Mutate = (operations: DesignOperation[], options?: { record?: boolean }) => Promise<boolean>;
const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Multi-selection, layer commands, clipboard, drop placement and undo/redo for frames. */
export function useDesignFrames({ board, document, primary, chooseFrame, canvas, view, canvasSize, mutate, history, canEdit, onError }: {
  board: RefObject<DesignDocument | null>; document: DesignDocument | null; primary: string;
  chooseFrame(id: string): boolean; canvas: RefObject<HTMLDivElement | null>; view: View; canvasSize: { width: number; height: number };
  mutate: Mutate; history: FrameHistory; canEdit(): boolean; onError(message: string): void;
}) {
  const [extra, setExtra] = useState<string[]>([]);
  const frames = useMemo(() => document?.frames ?? [], [document]);
  const visible = useMemo(() => new Set(frames.filter(frame => !frame.hidden).map(frame => frame.id)), [frames]);
  const selection: FrameSelection = useMemo(() => ({ primary, extra: extra.filter(id => id !== primary && visible.has(id)) }), [primary, extra, visible]);
  const ids = selectedIds(selection);
  const selected = frames.filter(frame => ids.includes(frame.id));
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const select = useCallback((next: FrameSelection) => {
    if (next.primary && next.primary !== primary && !chooseFrame(next.primary)) return false;
    setExtra(next.extra); return true;
  }, [primary, chooseFrame]);

  const commit = useCallback(async (operations: DesignOperation[], selectAdded = 0) => {
    if (!operations.length || !canEdit()) return false;
    const ok = await mutate(operations);
    const added = selectAdded ? board.current?.frames.slice(-selectAdded) : undefined;
    if (ok && added?.length) select({ primary: added[0]!.id, extra: added.slice(1).map(frame => frame.id) });
    return ok;
  }, [mutate, canEdit, board, select]);

  const gestures = useFrameGestures({ board, canvas, view,
    onMarquee: (hits, additive) => select(additive ? { primary: primary || hits[0] || '', extra: [...selection.extra, ...hits] } : { primary: hits.includes(primary) ? primary : hits[0] ?? primary, extra: hits }),
    onCommit: patches => void commit(setOperation(patches)),
    onConflict: () => onError('The board changed during the gesture. Try again.'),
  });

  const editable = selected.filter(editableFrame);
  const center = () => ({ x: (canvasSize.width / 2 - view.x) / view.scale, y: (canvasSize.height / 2 - view.y) / view.scale });
  const pasteText = (text: string | null | undefined) => {
    const clip = parseFrameClip(text, sanitizeMarkup);
    if (!clip) return false;
    const bounds = unionRect(clip)!; const at = center();
    void commit([pasteOperation(clip, { x: at.x - bounds.width / 2, y: at.y - bounds.height / 2 })], clip.length);
    return true;
  };
  const copyText = () => {
    if (!selectedRef.current.length) return null;
    const text = serializeFrames(selectedRef.current);
    try { localStorage.setItem(FRAME_CLIP_KEY, text); } catch { onError('The copied frames are too large for the clipboard.'); }
    return text;
  };
  const allIds = editable.map(frame => frame.id);
  const grouped = editable.length > 1 && editable.every(frame => frame.groupId && frame.groupId === editable[0]!.groupId);
  const actions = {
    undo: () => { if (canEdit()) void history.step('undo', board.current, operations => mutate(operations, { record: false }), onError); },
    redo: () => { if (canEdit()) void history.step('redo', board.current, operations => mutate(operations, { record: false }), onError); },
    copy: () => { const text = copyText(); if (text) void navigator.clipboard?.writeText(text).catch(() => undefined); },
    cut: () => { if (copyText() && allIds.length) void commit([{ type: 'frames.remove', frameIds: allIds }]); },
    paste: () => { let text: string | null = null; try { text = localStorage.getItem(FRAME_CLIP_KEY); } catch { /* Storage unavailable. */ } if (!pasteText(text)) onError('Copy frames before pasting.'); },
    duplicate: () => { if (editable.length) void commit([duplicateOperation(editable)], editable.length); },
    remove: () => { if (allIds.length) void commit([{ type: 'frames.remove', frameIds: allIds }]); },
    group: () => { if (grouped) void commit([{ type: 'frames.ungroup', groupId: editable[0]!.groupId! }]); else if (editable.length > 1) void commit([{ type: 'frames.group', frameIds: allIds }]); },
    stack: (to: DesignStackDirection) => { if (allIds.length) void commit([{ type: 'frames.stack', frameIds: allIds, to }]); },
    lock: () => { if (selected.length) void commit(setOperation(selected.map(frame => ({ frameId: frame.id, patch: { locked: !selected.every(item => item.locked) } })))); },
    hide: () => { if (selected.length) void commit(setOperation(selected.map(frame => ({ frameId: frame.id, patch: { hidden: true } })))); },
    toggle: (frame: DesignFrame, key: 'locked' | 'hidden') => void commit(setOperation([{ frameId: frame.id, patch: { [key]: !frame[key] } }])),
    selectAll: () => { const all = frames.filter(editableFrame).map(frame => frame.id); if (all.length) select({ primary: all.includes(primary) ? primary : all[0]!, extra: all }); },
    reorder: (dragId: string, targetId: string) => {
      const order = frames.map(frame => frame.id).filter(id => id !== dragId);
      order.splice(order.indexOf(targetId) + (frames.findIndex(frame => frame.id === dragId) < frames.findIndex(frame => frame.id === targetId) ? 1 : 0), 0, dragId);
      if (dragId !== targetId) void commit([{ type: 'frames.order', frameIds: order }]);
    },
  };
  const actionsRef = useRef(actions); actionsRef.current = actions;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (editableTarget(event.target) || event.defaultPrevented || !board.current) return;
      const mod = event.metaKey || event.ctrlKey; const key = event.key.toLowerCase(); const run = actionsRef.current;
      const command = mod && key === 'z' ? (event.shiftKey ? run.redo : run.undo) : mod && key === 'y' ? run.redo
        : mod && key === 'd' ? run.duplicate : mod && key === 'g' ? run.group : mod && key === 'a' ? run.selectAll
        : mod && event.shiftKey && key === 'l' ? run.lock : mod && event.shiftKey && key === 'h' ? run.hide
        : mod && (event.key === ']' || event.key === '}') ? () => run.stack(event.shiftKey ? 'front' : 'forward')
        : mod && (event.key === '[' || event.key === '{') ? () => run.stack(event.shiftKey ? 'back' : 'backward')
        : !mod && (event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current.length ? run.remove
        : !mod && event.key === 'Escape' ? () => setExtra([]) : undefined;
      if (!command) return;
      event.preventDefault(); command();
    };
    const copy = (event: ClipboardEvent) => {
      if (editableTarget(event.target) || window.getSelection()?.toString()) return;
      const text = copyText(); if (!text) return;
      event.clipboardData?.setData(FRAME_CLIP_MIME, text); event.clipboardData?.setData('text/plain', text); event.preventDefault();
      if (event.type === 'cut') actionsRef.current.remove();
    };
    const paste = (event: ClipboardEvent) => {
      if (editableTarget(event.target) || !board.current) return;
      const data = event.clipboardData;
      if (pasteText(data?.getData(FRAME_CLIP_MIME) || data?.getData('text/plain'))) event.preventDefault();
      else { let text: string | null = null; try { text = localStorage.getItem(FRAME_CLIP_KEY); } catch { /* Storage unavailable. */ } if (!data?.types.length && pasteText(text)) event.preventDefault(); }
    };
    window.addEventListener('keydown', keydown); window.addEventListener('copy', copy); window.addEventListener('cut', copy); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('copy', copy); window.removeEventListener('cut', copy); window.removeEventListener('paste', paste); };
  });

  /** Frame label/handle pointer-down: returns true when this hook handled it (selection or batch gesture). */
  const frameDrag = (event: PointerEvent, kind: DragKind, frame: DesignFrame) => {
    if (event.button !== 0) return false;
    if (event.shiftKey || event.metaKey || event.ctrlKey) { event.preventDefault(); event.stopPropagation(); select(clickSelection(frames, selection, frame.id, true)); return true; }
    const next = ids.includes(frame.id) ? selection : clickSelection(frames, selection, frame.id, false);
    if (frame.locked) { event.preventDefault(); event.stopPropagation(); select(next); return true; }
    if (selectedIds(next).length < 2) { setExtra([]); return false; }
    if (!canEdit() || !select(next)) return true;
    const moving = frames.filter(item => selectedIds(next).includes(item.id) && editableFrame(item));
    return gestures.startTransform(event, kind, moving) || true;
  };
  const startHandle = (event: PointerEvent, kind: FrameGestureKind) => { if (canEdit() && editable.length && event.button === 0) gestures.startTransform(event, kind, editable); };
  const nudge = (frame: DesignFrame, kind: DragKind, dx: number, dy: number) => {
    if (frame.locked) return true;
    if (kind !== 'move' || ids.length < 2 || !ids.includes(frame.id)) return false;
    void commit(setOperation(moveFrames(editable, dx, dy))); return true;
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    const data = event.dataTransfer; const box = canvas.current?.getBoundingClientRect();
    const at = { x: (event.clientX - (box?.left ?? 0) - view.x) / view.scale, y: (event.clientY - (box?.top ?? 0) - view.y) / view.scale };
    const file = [...data.files].find(item => /\.(html?|txt|md)$/i.test(item.name) || /^text\/(html|plain|markdown)$/.test(item.type));
    if (!file && !data.types.some(type => type === 'text/html' || type === 'text/plain' || type === FRAME_CLIP_MIME)) return;
    event.preventDefault();
    if (!canEdit()) return;
    const place = (content: { html?: string; text?: string; name?: string }) => { const operation = droppedFrame(content, at, sanitizeMarkup); if (operation) void commit([operation], 1); else onError('Dropped content is empty or larger than 24 KiB.'); };
    const clip = parseFrameClip(data.getData(FRAME_CLIP_MIME), sanitizeMarkup);
    if (clip) { void commit([pasteOperation(clip, at)], clip.length); return; }
    if (file) { if (file.size > 24576) { onError('Dropped files must be 24 KiB or smaller.'); return; } void file.text().then(text => place(/\.html?$/i.test(file.name) || file.type === 'text/html' ? { html: text, name: file.name } : { text, name: file.name })); return; }
    const html = data.getData('text/html'); place(html ? { html } : { text: data.getData('text/plain') });
  };
  const dragOver = (event: DragEvent<HTMLDivElement>) => { if (event.dataTransfer.types.some(type => type === 'Files' || type.startsWith('text/') || type === FRAME_CLIP_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
  const layerClick = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, frame: DesignFrame) => {
    if (!(event.shiftKey || event.metaKey || event.ctrlKey)) { setExtra(expandGroups(frames, [frame.id]).filter(id => id !== frame.id)); return false; }
    select(clickSelection(frames, selection, frame.id, true)); return true;
  };
  const previewed = gestures.patches.length ? previewFrames(frames, gestures.patches) : frames;
  const bounds: Rect | null = editable.length > 0 ? unionRect(previewed.filter(frame => editable.some(item => item.id === frame.id))) : null;
  return { selection, ids, selected, editable, grouped, actions, gestures, frameDrag, startHandle, nudge, drop, dragOver, layerClick, bounds,
    previewRect: (frame: DesignFrame) => gestures.patches.length ? previewed.find(item => item.id === frame.id) : undefined,
    keyboard: (event: ReactKeyboardEvent) => event, clearExtra: () => setExtra([]) };
}
export type DesignFrames = ReturnType<typeof useDesignFrames>;

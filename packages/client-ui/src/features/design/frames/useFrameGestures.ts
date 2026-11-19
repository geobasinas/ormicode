import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { DesignDocument, DesignFrame } from '@ormicode/protocol';
import type { Point, Rect, View } from '../design-model.ts';
import { snapFrame, type SnapGuide } from '../design-snap.ts';
import { angleAt, changedPatches, marqueeHits, moveFrames, rectFromPoints, rotateFrames, scaleFrames, unionRect, type FramePatch } from './frame-selection.ts';

export type FrameGestureKind = 'move' | 'resize' | 'rotate';
type GestureKind = { type: 'marquee'; additive: boolean } | { type: FrameGestureKind; frames: DesignFrame[]; bounds: Rect };
type Gesture = { pointer: number; start: Point; board: DesignDocument; view: View } & GestureKind;

/** Pointer gestures for several frames at once: marquee, batch move, batch resize and rotation. */
export function useFrameGestures({ board, canvas, view, onMarquee, onCommit, onConflict }: {
  board: RefObject<DesignDocument | null>;
  canvas: RefObject<HTMLDivElement | null>;
  view: View;
  onMarquee(ids: string[], additive: boolean): void;
  onCommit(patches: FramePatch[]): void;
  onConflict(): void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [patches, setPatches] = useState<FramePatch[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const world = (event: PointerEvent, at = view): Point => {
    const box = canvas.current?.getBoundingClientRect();
    return { x: (event.clientX - (box?.left ?? 0) - at.x) / at.scale, y: (event.clientY - (box?.top ?? 0) - at.y) / at.scale };
  };
  const begin = (event: PointerEvent, next: GestureKind) => {
    const document = board.current;
    if (!document || gesture.current) return false;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { ...next, pointer: event.pointerId, start: world(event), board: document, view } as Gesture;
    return true;
  };
  const startMarquee = (event: PointerEvent) => begin(event, { type: 'marquee', additive: event.shiftKey || event.metaKey || event.ctrlKey });
  const startTransform = (event: PointerEvent, type: FrameGestureKind, frames: DesignFrame[]) => {
    const bounds = unionRect(frames);
    return !!bounds && begin(event, { type, frames, bounds });
  };
  const reset = () => { gesture.current = null; setPatches([]); setMarquee(null); setGuides([]); };
  const compute = (active: Gesture, event: PointerEvent): FramePatch[] => {
    if (active.type === 'marquee') return [];
    const point = world(event, active.view);
    const dx = point.x - active.start.x; const dy = point.y - active.start.y;
    const { frames, bounds } = active;
    if (active.type === 'resize') {
      const width = Math.max(80, bounds.width + dx); const height = Math.max(80, bounds.height + dy);
      const ratio = event.shiftKey ? Math.max(width / bounds.width, height / bounds.height) : 0;
      return scaleFrames(frames, bounds, { ...bounds, width: ratio ? bounds.width * ratio : width, height: ratio ? bounds.height * ratio : height });
    }
    if (active.type === 'rotate') {
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const delta = angleAt(center, point) - angleAt(center, active.start);
      return rotateFrames(frames, center, event.shiftKey ? Math.round(delta / 15) * 15 : delta);
    }
    const moved = { ...bounds, x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) };
    const ids = new Set(frames.map(frame => frame.id));
    const snapped = event.altKey ? { rect: moved, guides: [] } : snapFrame(moved, active.board.frames.filter(frame => !ids.has(frame.id) && !frame.hidden), 'move', active.view.scale);
    setGuides(snapped.guides);
    return moveFrames(frames, snapped.rect.x - bounds.x, snapped.rect.y - bounds.y);
  };
  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointer) return false;
    if (board.current !== active.board) { reset(); onConflict(); return true; }
    if (active.type === 'marquee') setMarquee(rectFromPoints(active.start, world(event, active.view)));
    else setPatches(compute(active, event));
    return true;
  };
  const end = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointer) return false;
    const stale = board.current !== active.board;
    const rect = rectFromPoints(active.start, world(event, active.view));
    const next = active.type === 'marquee' ? [] : changedPatches(active.frames, compute(active, event));
    reset();
    if (stale) { onConflict(); return true; }
    if (active.type === 'marquee') { if (rect.width > 2 / active.view.scale || rect.height > 2 / active.view.scale || !active.additive) onMarquee(rect.width || rect.height ? marqueeHits(active.board.frames, rect) : [], active.additive); }
    else if (next.length) onCommit(next);
    return true;
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId !== gesture.current?.pointer) return false;
    reset(); return true;
  };
  return { patches, marquee, guides, startMarquee, startTransform, move, end, cancel, active: () => gesture.current !== null };
}

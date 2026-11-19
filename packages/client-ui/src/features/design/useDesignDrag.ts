import { useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import type { DesignDocument, DesignFrame, DesignOperation } from '@ormicode/protocol';
import { clampPosition, resizeRect, type Rect, type View } from './design-model.ts';
import { snapFrame, type DragKind, type SnapGuide } from './design-snap.ts';

type Origin = { pointer: number; x: number; y: number; view: View };
type Gesture = Origin & (
  { type: 'pan' } |
  { type: DragKind; frame: DesignFrame; board: DesignDocument; rect: Rect }
);
type DragPreview = { id: string; rect: Rect; guides: SnapGuide[] };

export function useDesignDrag({ board, view, panTool, setView, chooseFrame, canDrag, onCommit, onConflict }: {
  board: RefObject<DesignDocument | null>;
  view: View;
  panTool: boolean;
  setView: Dispatch<SetStateAction<View>>;
  chooseFrame(id: string): boolean;
  canDrag(): boolean;
  onCommit(operation: DesignOperation): void;
  onConflict(): void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [panning, setPanning] = useState(false);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const capture = (event: PointerEvent): Origin => {
    event.currentTarget.setPointerCapture(event.pointerId);
    return { pointer: event.pointerId, x: event.clientX, y: event.clientY, view };
  };
  const startPan = (event: PointerEvent) => {
    if (gesture.current || (event.button !== 0 && event.button !== 1)) return;
    if (!panTool && event.button !== 1 && event.target !== event.currentTarget) return;
    event.preventDefault();
    gesture.current = { ...capture(event), type: 'pan' };
    setPanning(true);
  };
  const startDrag = (event: PointerEvent, type: DragKind, frame: DesignFrame) => {
    const document = board.current;
    if (gesture.current || !document || event.button !== 0 || panTool || !canDrag() || !chooseFrame(frame.id)) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = { ...capture(event), type, frame, board: document, rect: frame };
  };
  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointer) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (active.type === 'pan') {
      setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
      return;
    }
    if (board.current !== active.board) { cancel(event); onConflict(); return; }
    if (active.rect === active.frame && dx === 0 && dy === 0) return;
    const { frame, type, view } = active;
    const x = dx / view.scale;
    const y = dy / view.scale;
    const rect = type === 'resize' ? resizeRect(frame, x, y)
      : { x: clampPosition(Math.round(frame.x + x)), y: clampPosition(Math.round(frame.y + y)), width: frame.width, height: frame.height };
    const next = event.altKey ? { rect, guides: [] }
      : snapFrame(rect, active.board.frames.filter(item => item.id !== frame.id), type, view.scale);
    active.rect = next.rect;
    setPreview({ id: frame.id, ...next });
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId !== gesture.current?.pointer) return;
    gesture.current = null;
    setPreview(null);
    setPanning(false);
  };
  const end = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointer) return;
    cancel(event);
    if (active.type === 'pan') return;
    if (board.current !== active.board) { onConflict(); return; }
    const { frame, rect } = active;
    if (frame.x === rect.x && frame.y === rect.y && frame.width === rect.width && frame.height === rect.height) return;
    const patch = active.type === 'resize' ? { width: rect.width, height: rect.height } : { x: rect.x, y: rect.y };
    onCommit({ type: 'frame.update', frameId: frame.id, patch });
  };
  return { panning, preview, startPan, startDrag, move, cancel, end };
}

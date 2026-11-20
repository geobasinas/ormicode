import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { View } from './design-model.ts';
import { bounds, distance, documentPoint, drawingFrame, MAX_ANCHORS, mirroredAnchor, pathData, sampleStroke, shapeEnd, type Anchor, type DrawTool, type Path, type Point } from './vector-geometry.ts';

export type Artwork = NonNullable<ReturnType<typeof drawingFrame>>;
type Gesture = { id: number; start: Point; close: boolean };
const empty: Path = { anchors: [], closed: false };
const isBox = (tool: DrawTool) => tool === 'rectangle' || tool === 'ellipse';

export function DesignVectorDrawing({ tool, view, onFinish, onCancel, onError }: {
  tool: DrawTool; view: View; onFinish(art: Artwork): void; onCancel(): void; onError(message: string): void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const saved = useRef<Path>(empty);
  const draft = useRef<Path>(empty);
  const [preview, setPreview] = useState<Path>(empty);
  useEffect(() => { surface.current?.focus(); }, []);
  const show = (next: Path) => { draft.current = next; setPreview(next); };
  const point = (event: PointerEvent): Point => {
    const box = surface.current!.getBoundingClientRect();
    return documentPoint({ x: event.clientX, y: event.clientY }, { x: box.left, y: box.top }, view);
  };
  const finish = (path: Path) => {
    if (path.anchors.length < 2) return;
    const artwork = drawingFrame(tool, path);
    if (artwork) onFinish(artwork);
    else { onError('Drawing exceeds frame bounds. Draw a smaller shape or shorten its Bézier handles.'); saved.current = empty; show(empty); }
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const at = point(event), anchors = saved.current.anchors;
    const close = tool === 'pen' && anchors.length > 2 && distance(anchors[0]!, at) * view.scale <= 10;
    if (tool === 'pen' && anchors.length >= MAX_ANCHORS && !close) { finish(saved.current); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, start: at, close };
    if (close) show({ anchors, closed: true });
    else show({ anchors: tool === 'pen' ? [...anchors, at] : [at], closed: false });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const current = gesture.current;
    if (!current || event.pointerId !== current.id || current.close) return;
    const at = point(event), { start } = current;
    if (tool === 'pen') {
      const anchor: Anchor = distance(start, at) * view.scale > 3 ? mirroredAnchor(start, shapeEnd(start, at, event.shiftKey, true)) : start;
      show({ anchors: [...saved.current.anchors, anchor], closed: false });
    } else if (tool === 'freehand') {
      show({ anchors: sampleStroke(draft.current.anchors, at, 2 / view.scale), closed: false });
    } else show({ anchors: [start, shapeEnd(start, at, event.shiftKey, tool === 'line')], closed: false });
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    move(event);
    gesture.current = null;
    let path = draft.current;
    if (tool === 'pen') {
      saved.current = path;
      if (current.close) finish(path);
      return;
    }
    if (tool === 'freehand') show(empty);
    else if (distance(current.start, path.anchors[1] ?? current.start) * view.scale < 3) {
      path = { anchors: [current.start, { x: current.start.x + 120, y: current.start.y + (tool === 'line' ? 0 : 96) }], closed: false };
    }
    finish(path);
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    show(saved.current);
  };
  const { anchors } = preview;
  const box = isBox(tool) && anchors.length > 1 ? bounds(anchors) : null;

  return <div className="design-vector-surface" data-vector-tool={tool} ref={surface} tabIndex={-1}
    aria-label="Drawing surface" onPointerDown={start} onPointerMove={move} onPointerUp={end}
    onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      if (tool !== 'pen' || gesture.current) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(saved.current); }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault(); saved.current = { anchors: saved.current.anchors.slice(0, -1), closed: false }; show(saved.current);
      }
    }}>
    <svg aria-hidden className="design-vector-draft">
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {box ? tool === 'rectangle' ? <rect {...box} /> :
          <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} /> :
          <path d={pathData(preview)} fill={preview.closed ? undefined : 'none'} />}
        {tool === 'pen' && anchors.map((anchor, index) => <g key={index}>
          {[anchor.incoming, anchor.outgoing].map((handle, i) => handle &&
            <line key={i} x1={anchor.x} y1={anchor.y} x2={handle.x} y2={handle.y} />)}
          <circle cx={anchor.x} cy={anchor.y} r={(index === 0 ? 5 : 3) / view.scale} />
        </g>)}
      </g>
    </svg>
    <div className="design-vector-hint">{tool === 'pen'
      ? 'Click to add anchors, drag for curves. Click the first anchor to close, Enter to finish, Esc to cancel.'
      : tool === 'freehand' ? 'Drag to draw a stroke. Esc to cancel.' : 'Click or drag to place. Hold Shift to constrain. Esc to cancel.'}</div>
  </div>;
}

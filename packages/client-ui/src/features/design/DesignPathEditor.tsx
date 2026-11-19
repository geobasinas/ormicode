import { useRef, useState, type PointerEvent } from 'react';
import { mirroredAnchor, pathData, replaceAnchor, type Box, type Path, type Point } from './vector-geometry.ts';

type Part = 'anchor' | 'incoming' | 'outgoing';

export function DesignPathEditor({ path, viewBox, onChange }: { path: Path; viewBox: Box; onChange(path: Path): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; index: number; part: Part; original: Path; offset: Point; x: number; y: number; moved: boolean } | null>(null);
  const [selected, setSelected] = useState(0);
  const radius = Math.max(viewBox.width, viewBox.height) / 85;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current, matrix = svg.current?.getScreenCTM();
    if (!current || current.id !== event.pointerId || !matrix) return;
    if (!current.moved && Math.hypot(current.x - event.clientX, current.y - event.clientY) < 2) return;
    current.moved = true;
    const mapped = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = Math.max(viewBox.x, Math.min(mapped.x + current.offset.x, viewBox.x + viewBox.width));
    const y = Math.max(viewBox.y, Math.min(mapped.y + current.offset.y, viewBox.y + viewBox.height));
    onChange(replaceAnchor(current.original, current.index, current.part, { x, y }, !event.altKey));
  };
  const control = (event: PointerEvent<SVGCircleElement>, index: number, part: Part) => {
    const matrix = svg.current?.getScreenCTM();
    if (event.button !== 0 || !event.isPrimary || drag.current || !matrix) return;
    const mapped = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const anchor = path.anchors[index]!;
    const point = part === 'anchor' ? anchor : anchor[part]!;
    svg.current?.focus();
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, index, part, original: path,
      offset: { x: point.x - mapped.x, y: point.y - mapped.y }, x: event.clientX, y: event.clientY, moved: false };
    setSelected(index);
  };
  const cancel = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    const { original } = drag.current;
    drag.current = null;
    onChange(original);
  };
  return <>
    <svg className="design-vector-path-editor" ref={svg} tabIndex={0} aria-label="Path anchors and Bézier handles"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      onPointerMove={move} onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        move(event); drag.current = null;
      }} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => {
        if ((event.key === 'Backspace' || event.key === 'Delete') && path.anchors.length > (path.closed ? 3 : 2)) {
          event.preventDefault();
          onChange({ ...path, anchors: path.anchors.filter((_, index) => index !== selected) });
          setSelected(Math.max(0, selected - 1));
        }
      }}>
      <path className="design-vector-edit-curve" d={pathData(path)} />
      {path.anchors.map((anchor, index) => <g key={index}>
        {(['incoming', 'outgoing'] as const).map(part => {
          const point = anchor[part];
          return point && <g key={part}>
            <line className="design-vector-arm" x1={anchor.x} y1={anchor.y} x2={point.x} y2={point.y} />
            <circle className="design-vector-handle" cx={point.x} cy={point.y} r={radius * .75}
              onPointerDown={event => control(event, index, part)} />
          </g>;
        })}
        <circle className="design-vector-anchor" cx={anchor.x} cy={anchor.y} r={radius} data-active={index === selected}
          onPointerDown={event => control(event, index, 'anchor')} />
      </g>)}
    </svg>
    <div className="design-vector-format">
      <button className="design-vector-button" type="button" onClick={() => onChange({
        ...path, anchors: path.anchors.map((point, i) => i !== selected ? point : point.incoming || point.outgoing
          ? { x: point.x, y: point.y }
          : mirroredAnchor(point, { x: point.x + 3 * radius, y: point.y })),
      })}>Toggle handles</button>
    </div>
    <p className="design-vector-description">Drag anchors or handles; Alt moves one handle. Delete removes the selected anchor.</p>
  </>;
}

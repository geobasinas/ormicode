export type Point = { x: number; y: number };
export type Anchor = Point & { incoming?: Point; outgoing?: Point };
export type Path = { anchors: Anchor[]; closed: boolean };
export type DrawTool = 'rectangle' | 'ellipse' | 'line' | 'freehand' | 'pen';
export type Box = Point & { width: number; height: number };

export const MAX_STROKE_POINTS = 512;
export const MAX_ANCHORS = 96;
const coordinate = (value: number) => Math.round(value * 100) / 100;
const pair = ({ x, y }: Point) => `${coordinate(x)} ${coordinate(y)}`;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function documentPoint(client: Point, bounds: Point, view: Point & { scale: number }): Point {
  return { x: (client.x - bounds.x - view.x) / view.scale, y: (client.y - bounds.y - view.y) / view.scale };
}

export function shapeEnd(start: Point, end: Point, constrain: boolean, line: boolean): Point {
  if (!constrain) return end;
  const dx = end.x - start.x, dy = end.y - start.y;
  if (line) {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
}

export function mirroredAnchor(anchor: Point, handle: Point): Anchor {
  return { ...anchor, outgoing: handle, incoming: { x: 2 * anchor.x - handle.x, y: 2 * anchor.y - handle.y } };
}

function segment(from: Anchor, to: Anchor): string {
  return from.outgoing || to.incoming
    ? ` C ${pair(from.outgoing ?? from)} ${pair(to.incoming ?? to)} ${pair(to)}`
    : ` L ${pair(to)}`;
}

export function pathData({ anchors, closed }: Path): string {
  const first = anchors[0];
  if (!first) return '';
  let d = `M ${pair(first)}`;
  for (let index = 1; index < anchors.length; index++) d += segment(anchors[index - 1]!, anchors[index]!);
  if (closed) {
    const last = anchors.at(-1)!;
    if (last.outgoing || first.incoming) d += segment(last, first);
    d += ' Z';
  }
  return d;
}

export function parseEditablePath(d: string): Path | null {
  if (d.length > 8192) return null;
  const tokens = d.trim().replace(/,/g, ' ').match(/[MLCZ]|-?(?:\d+(?:\.\d*)?|\.\d+)|\S+/g) ?? [];
  let index = 0;
  const point = () => {
    const x = Number(tokens[index++]), y = Number(tokens[index++]);
    return Number.isFinite(x) && Number.isFinite(y) && Math.max(Math.abs(x), Math.abs(y)) <= 1e6 ? { x, y } : null;
  };
  if (tokens[index++] !== 'M') return null;
  const start: Anchor | null = point();
  if (!start) return null;
  const anchors: Anchor[] = [start];
  let closed = false;
  while (index < tokens.length && anchors.length <= MAX_ANCHORS) {
    const command = tokens[index++];
    if (command === 'Z' && index === tokens.length) { closed = true; break; }
    if (command !== 'L' && command !== 'C') return null;
    const previous = anchors.at(-1)!;
    const outgoing = command === 'C' ? point() : null;
    const incoming = command === 'C' ? point() : null;
    const next: Anchor | null = point();
    if (!next || (command === 'C' && (!outgoing || !incoming))) return null;
    if (outgoing && distance(previous, outgoing)) previous.outgoing = outgoing;
    if (incoming && distance(next, incoming)) next.incoming = incoming;
    if (tokens[index] === 'Z' && incoming && !distance(start, next)) {
      if (next.incoming) start.incoming = next.incoming;
    } else anchors.push(next);
  }
  return index === tokens.length && anchors.length >= 2 && anchors.length <= MAX_ANCHORS ? { anchors, closed } : null;
}

export function replaceAnchor(path: Path, index: number, part: 'anchor' | 'incoming' | 'outgoing', at: Point, mirror: boolean): Path {
  return { ...path, anchors: path.anchors.map((anchor, i) => {
    if (i !== index) return anchor;
    if (part === 'anchor') {
      const move = (point?: Point) => point && ({ x: point.x + at.x - anchor.x, y: point.y + at.y - anchor.y });
      return { ...at, incoming: move(anchor.incoming), outgoing: move(anchor.outgoing) };
    }
    const opposite = part === 'incoming' ? 'outgoing' : 'incoming';
    return { ...anchor, [part]: at, ...(mirror ? { [opposite]: { x: 2 * anchor.x - at.x, y: 2 * anchor.y - at.y } } : {}) };
  }) };
}

export function sampleStroke(points: Point[], next: Point, spacing: number): Point[] {
  const last = points.at(-1);
  if (last && distance(last, next) < spacing) return points;
  const sampled = points.length < MAX_STROKE_POINTS ? points : points.filter((_, index) => index % 2 === 0);
  return [...sampled, next];
}

export function bounds(points: Point[]): Box {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function drawingFrame(tool: DrawTool, path: Path) {
  const { anchors } = path;
  if (anchors.length < 2 || anchors.some(p => [p, p.incoming, p.outgoing].some(v => v && (!Number.isFinite(v.x) || !Number.isFinite(v.y))))) return null;
  const box = bounds(anchors.flatMap(point => [point, ...(point.incoming ? [point.incoming] : []), ...(point.outgoing ? [point.outgoing] : [])]));
  const x = box.x - 3, y = box.y - 3;
  const width = Math.max(80, Math.ceil(box.width + 6)), height = Math.max(80, Math.ceil(box.height + 6));
  if (width > 4096 || height > 4096 || Math.abs(x) > 100000 || Math.abs(y) > 100000) return null;
  const local = (point: Point): Point => ({ x: point.x - x, y: point.y - y });
  const [start, end] = anchors.map(local);
  const geometry = tool === 'rectangle'
    ? `<rect x="3" y="3" width="${coordinate(box.width)}" height="${coordinate(box.height)}"/>`
    : tool === 'ellipse'
      ? `<ellipse cx="${coordinate(3 + box.width / 2)}" cy="${coordinate(3 + box.height / 2)}" rx="${coordinate(box.width / 2)}" ry="${coordinate(box.height / 2)}"/>`
      : tool === 'line' ? `<line x1="${coordinate(start!.x)}" y1="${coordinate(start!.y)}" x2="${coordinate(end!.x)}" y2="${coordinate(end!.y)}"/>`
        : `<path d="${pathData({ ...path, anchors: anchors.map(p => ({ ...local(p), incoming: p.incoming && local(p.incoming), outgoing: p.outgoing && local(p.outgoing) })) })}"/>`;
  const fill = tool === 'rectangle' || tool === 'ellipse' || path.closed ? '#d4d4d8' : 'none';
  const html = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" fill="${fill}" stroke="#3f3f46" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</svg>`;
  return html.length <= 8192 ? { name: { rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', freehand: 'Freehand', pen: 'Bézier path' }[tool], x, y, width, height, html, styles: '' } : null;
}

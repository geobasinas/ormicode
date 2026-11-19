import { clampPosition, MAX_FRAME_SIZE, MIN_FRAME_SIZE, type Rect } from './design-model.ts';

export type DragKind = 'move' | 'resize';
export type SnapGuide = { axis: 'x' | 'y'; at: number; from: number; to: number };

const anchors = (start: number, length: number) => [start, start + length / 2, start + length];
const sizeKey = { x: 'width', y: 'height' } as const;
const otherAxis = { x: 'y', y: 'x' } as const;

export function snapFrame(rect: Rect, others: readonly Rect[], kind: DragKind, scale: number, lines: readonly { axis: 'x' | 'y'; at: number }[] = []) {
  const guides: SnapGuide[] = [];
  const result = { ...rect };
  for (const axis of ['x', 'y'] as const) {
    const size = sizeKey[axis];
    const movingAnchors = kind === 'move' ? anchors(rect[axis], rect[size]) : [rect[axis] + rect[size]];
    const cross = otherAxis[axis];
    const crossSize = sizeKey[cross];
    let nearest: { delta: number; at: number; target: Rect } | undefined;
    const tolerance = 8 / scale;
    const targets = [...others.map(target => ({ target, values: anchors(target[axis], target[size]) })), ...lines.filter(line => line.axis === axis).map(line => ({ target: rect, values: [line.at] }))];
    for (const { target, values } of targets) {
      for (const at of values) {
        for (const from of movingAnchors) {
          const delta = at - from;
          // Persisted frame geometry uses integer pixels. Only show achievable alignments.
          if (!Number.isInteger(delta) || Math.abs(delta) > tolerance || (nearest && Math.abs(delta) >= Math.abs(nearest.delta))) continue;
          if (kind === 'resize' && (rect[size] + delta < MIN_FRAME_SIZE || rect[size] + delta > MAX_FRAME_SIZE)) continue;
          if (kind === 'move' && clampPosition(rect[axis] + delta) !== rect[axis] + delta) continue;
          nearest = { delta, at, target };
        }
      }
    }
    if (!nearest) continue;
    if (kind === 'move') result[axis] += nearest.delta;
    else result[size] += nearest.delta;
    guides.push({ axis, at: nearest.at, from: nearest.target[cross], to: nearest.target[cross] + nearest.target[crossSize] });
  }
  for (const guide of guides) {
    const cross = otherAxis[guide.axis];
    guide.from = Math.min(guide.from, result[cross]);
    guide.to = Math.max(guide.to, result[cross] + result[sizeKey[cross]]);
  }
  return { rect: result, guides };
}

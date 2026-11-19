import type { DesignFrame, DesignFramePatch, DesignOperation } from '@ormicode/protocol';
import { clampPosition, MAX_FRAME_SIZE, MIN_FRAME_SIZE, type Point, type Rect } from '../design-model.ts';

export interface FrameSelection { primary: string; extra: string[] }
export type FramePatch = { frameId: string; patch: DesignFramePatch };

export const editableFrame = (frame: Pick<DesignFrame, 'locked' | 'hidden'>) => !frame.locked && !frame.hidden;
export const selectedIds = ({ primary, extra }: FrameSelection) => primary ? [primary, ...extra.filter(id => id !== primary)] : [...extra];

/** All members of the groups any of `ids` belong to, in board order. */
export function expandGroups(frames: readonly DesignFrame[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set(frames.filter(frame => wanted.has(frame.id) && frame.groupId).map(frame => frame.groupId));
  return frames.filter(frame => wanted.has(frame.id) || (frame.groupId && groups.has(frame.groupId))).map(frame => frame.id);
}

/** Keep the primary first; drop ids that no longer exist or are hidden. */
export function reconcileSelection(frames: readonly DesignFrame[], selection: FrameSelection): FrameSelection {
  const visible = new Set(frames.filter(frame => !frame.hidden).map(frame => frame.id));
  const extra = selection.extra.filter((id, index, all) => visible.has(id) && id !== selection.primary && all.indexOf(id) === index);
  return visible.has(selection.primary) ? { primary: selection.primary, extra } : { primary: extra[0] ?? '', extra: extra.slice(1) };
}

/** Click: select a frame together with its group. Shift-click toggles it (and its group) in the selection. */
export function clickSelection(frames: readonly DesignFrame[], current: FrameSelection, id: string, additive: boolean): FrameSelection {
  const members = expandGroups(frames, [id]);
  if (!additive) return { primary: id, extra: members.filter(item => item !== id) };
  const selected = selectedIds(current);
  if (members.every(item => selected.includes(item)) && selected.length > members.length) {
    const rest = selected.filter(item => !members.includes(item));
    return { primary: rest[0]!, extra: rest.slice(1) };
  }
  if (!current.primary) return { primary: id, extra: members.filter(item => item !== id) };
  return { primary: current.primary, extra: [...new Set([...current.extra, ...members])].filter(item => item !== current.primary) };
}

export function rotatedBounds(frame: Rect & { rotation?: number }): Rect {
  const angle = ((frame.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle)); const sin = Math.abs(Math.sin(angle));
  const width = frame.width * cos + frame.height * sin; const height = frame.width * sin + frame.height * cos;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

export function unionRect(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(rect => rect.x)); const y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}

export const rectFromPoints = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Marquee hits: visible, unlocked frames touching the rectangle, expanded to whole groups. */
export function marqueeHits(frames: readonly DesignFrame[], rect: Rect): string[] {
  const hits = frames.filter(frame => editableFrame(frame) && intersects(rotatedBounds(frame), rect)).map(frame => frame.id);
  return expandGroups(frames, hits).filter(id => editableFrame(frames.find(frame => frame.id === id)!));
}

export function normalizeAngle(degrees: number): number {
  const turned = ((Math.round(degrees) % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}
export const angleAt = (center: Point, point: Point) => (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
const clampSize = (value: number) => Math.round(Math.max(MIN_FRAME_SIZE, Math.min(MAX_FRAME_SIZE, value)));

export function moveFrames(frames: readonly DesignFrame[], dx: number, dy: number): FramePatch[] {
  return frames.map(frame => ({ frameId: frame.id, patch: { x: clampPosition(Math.round(frame.x + dx)), y: clampPosition(Math.round(frame.y + dy)) } }));
}

/** Scale frames from the bounds' top-left corner so the selection fills `next`. */
export function scaleFrames(frames: readonly DesignFrame[], bounds: Rect, next: Rect): FramePatch[] {
  const sx = next.width / Math.max(1, bounds.width); const sy = next.height / Math.max(1, bounds.height);
  return frames.map(frame => ({ frameId: frame.id, patch: {
    x: clampPosition(Math.round(next.x + (frame.x - bounds.x) * sx)), y: clampPosition(Math.round(next.y + (frame.y - bounds.y) * sy)),
    width: clampSize(frame.width * sx), height: clampSize(frame.height * sy),
  } }));
}

/** Turn every frame about `center` by `delta` degrees, keeping each frame's size. */
export function rotateFrames(frames: readonly DesignFrame[], center: Point, delta: number): FramePatch[] {
  const radians = (delta * Math.PI) / 180; const cos = Math.cos(radians); const sin = Math.sin(radians);
  return frames.map(frame => {
    const cx = frame.x + frame.width / 2 - center.x; const cy = frame.y + frame.height / 2 - center.y;
    const x = center.x + cx * cos - cy * sin - frame.width / 2; const y = center.y + cx * sin + cy * cos - frame.height / 2;
    return { frameId: frame.id, patch: { x: clampPosition(Math.round(x)), y: clampPosition(Math.round(y)), rotation: normalizeAngle((frame.rotation ?? 0) + delta) } };
  });
}

/** Apply patches to frames for a live preview. */
export function previewFrames<T extends DesignFrame>(frames: readonly T[], patches: readonly FramePatch[]): T[] {
  const byId = new Map(patches.map(item => [item.frameId, item.patch]));
  return frames.map(frame => { const patch = byId.get(frame.id); return patch ? { ...frame, ...patch } as T : frame; });
}

export function changedPatches(frames: readonly DesignFrame[], patches: readonly FramePatch[]): FramePatch[] {
  return patches.filter(({ frameId, patch }) => {
    const frame = frames.find(item => item.id === frameId) as Record<string, unknown> | undefined;
    return frame && Object.entries(patch).some(([key, value]) => (frame[key] ?? (key === 'rotation' ? 0 : undefined)) !== value);
  });
}

export const setOperation = (patches: FramePatch[]): DesignOperation[] => patches.length ? [{ type: 'frames.set', frames: patches }] : [];

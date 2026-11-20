import { designOperationSchema, DESIGN_FRAME_LIMIT, type DesignFrame, type DesignOperation } from '@ormicode/protocol';
import { clampPosition, type Point } from '../design-model.ts';

export const FRAME_CLIP_MIME = 'application/x-ormicode-frames';
export const FRAME_CLIP_KEY = 'ormicode.design.frameClipboard';
const CLIP_BYTES = 192 * 1024;
type PasteOperation = Extract<DesignOperation, { type: 'frames.paste' }>;
type ClipFrame = PasteOperation['frames'][number];
export interface FrameClip { kind: 'ormicode.frames'; version: 1; frames: ClipFrame[] }

/** Copied frames keep their layout relative to the selection's top-left corner. */
export function serializeFrames(frames: readonly DesignFrame[]): string {
  const left = Math.min(...frames.map(frame => frame.x)); const top = Math.min(...frames.map(frame => frame.y));
  const clip: FrameClip = { kind: 'ormicode.frames', version: 1, frames: frames.slice(0, DESIGN_FRAME_LIMIT).map(frame => ({
    name: frame.name, x: frame.x - left, y: frame.y - top, width: frame.width, height: frame.height, html: frame.html, styles: frame.styles,
    ...(frame.rotation ? { rotation: frame.rotation } : {}), ...(frame.hidden ? { hidden: true } : {}), ...(frame.groupId ? { groupKey: frame.groupId } : {}),
  })) };
  return JSON.stringify(clip);
}

/** Parse untrusted clipboard text into bounded, schema-valid frames, or null. */
export function parseFrameClip(text: string | null | undefined, sanitize: (html: string) => string): ClipFrame[] | null {
  if (!text || new TextEncoder().encode(text).byteLength > CLIP_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const clip = raw as Partial<FrameClip> | null;
  if (!clip || clip.kind !== 'ormicode.frames' || clip.version !== 1 || !Array.isArray(clip.frames)) return null;
  const parsed = designOperationSchema.safeParse({ type: 'frames.paste', frames: clip.frames });
  if (!parsed.success || parsed.data.type !== 'frames.paste') return null;
  return parsed.data.frames.map(frame => ({ ...frame, html: sanitize(frame.html) }));
}

/** Paste with the copied layout's top-left at `at`; copies are unlocked. */
export function pasteOperation(frames: readonly ClipFrame[], at: Point): PasteOperation {
  return { type: 'frames.paste', frames: frames.map(({ locked: _, ...frame }) => ({
    ...frame, name: frame.name, x: clampPosition(Math.round(at.x + frame.x)), y: clampPosition(Math.round(at.y + frame.y)),
  })) };
}

export function duplicateOperation(frames: readonly DesignFrame[], offset = 40): PasteOperation {
  const clip = JSON.parse(serializeFrames(frames)) as FrameClip;
  const left = Math.min(...frames.map(frame => frame.x)); const top = Math.min(...frames.map(frame => frame.y));
  return pasteOperation(clip.frames.map(frame => ({ ...frame, name: `${frame.name.slice(0, 110)} copy` })), { x: left + offset, y: top + offset });
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** A frame for HTML or text dropped onto the canvas, centred on the drop point. */
export function droppedFrame(content: { html?: string; text?: string; name?: string }, at: Point, sanitize: (html: string) => string): PasteOperation | null {
  const body = content.html ? sanitize(content.html) : content.text ? `<main style="min-height:100%;padding:24px;white-space:pre-wrap;font-family:Inter,system-ui,sans-serif">${escapeHtml(content.text)}</main>` : '';
  if (!body.trim() || body.length > 24576) return null;
  const width = 640; const height = 480;
  const name = (content.name ?? 'Dropped frame').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 120) || 'Dropped frame';
  const operation: PasteOperation = { type: 'frames.paste', frames: [{ name, x: clampPosition(Math.round(at.x - width / 2)), y: clampPosition(Math.round(at.y - height / 2)), width, height, html: body, styles: '' }] };
  return designOperationSchema.safeParse(operation).success ? operation : null;
}

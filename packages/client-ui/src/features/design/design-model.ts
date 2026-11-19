import { DESIGN_STYLE_VALUE_LIMIT, STYLE_RULES, isEditableProperty, styleRule } from '@ormicode/protocol';
import { validElementGeometry } from './design-inspector-model.ts';
import { INSPECTOR_LAYER_EXPORT_LIMIT } from './inspector-bridge-script.ts';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const MIN_FRAME_SIZE = 80;
export const MAX_FRAME_SIZE = 4096;
export const clampPosition = (value: number) => Math.max(-100000, Math.min(100000, value));
export interface Rect { x: number; y: number; width: number; height: number }
export interface View { x: number; y: number; scale: number }
export interface Point { x: number; y: number }

export function reconcileFrameSelection(frames: readonly { id: string }[], selected: string): string {
  return frames.some(frame => frame.id === selected) ? selected : frames[0]?.id ?? '';
}

export function zoomAt(view: View, point: Point, factor: number): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

export function fitView(rects: Rect[], width: number, height: number, padding = 48): View {
  if (!rects.length || width <= 0 || height <= 0) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  const scale = Math.max(MIN_ZOOM, Math.min(1, MAX_ZOOM, (width - padding * 2) / Math.max(1, right - left), (height - padding * 2) / Math.max(1, bottom - top)));
  return { scale, x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale };
}

export function fitCanvas(rects: Rect[], width: number, height: number): View {
  // Leave an extra strip below the artboards for the toolbar and dimension labels.
  return fitView(rects, width, height - 42);
}

export function resizeRect(rect: Rect, dx: number, dy: number): Rect {
  const clampSize = (value: number) => Math.round(Math.max(MIN_FRAME_SIZE, Math.min(MAX_FRAME_SIZE, value)));
  return { x: rect.x, y: rect.y, width: clampSize(rect.width + dx), height: clampSize(rect.height + dy) };
}

export interface BridgeMessage { channel: string; type: string; [key: string]: unknown }
export function validateBridgeMessage(value: unknown, channel: string): value is BridgeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== channel || typeof message.type !== 'string') return false;
  if (message.type === 'selected') {
    if (Object.keys(message).some(key => !['channel', 'type', 'id', 'path', 'tag', 'leaf', 'text', 'styles', 'computed', 'geometry', 'alt'].includes(key)) || typeof message.id !== 'string' || !/^n[0-9]{1,10}$/.test(message.id) || typeof message.path !== 'string' || (message.path !== '' && !/^\d{1,5}(?:\.\d{1,5}){0,23}$/.test(message.path)) || typeof message.tag !== 'string' || !/^[a-z0-9]{1,20}$/.test(message.tag) || typeof message.leaf !== 'boolean' || typeof message.text !== 'string' || message.text.length > 500) return false;
    if ('alt' in message && (message.tag !== 'img' || typeof message.alt !== 'string' || message.alt.length > 500)) return false;
    if (message.geometry !== undefined && !validElementGeometry(message.geometry)) return false;
    return validStyleSnapshot(message.styles) && validStyleSnapshot(message.computed);
  }
  if (message.type === 'serialized') return Object.keys(message).every(key => ['channel', 'type', 'html', 'stamp'].includes(key))
    && Number.isSafeInteger(message.stamp) && typeof message.html === 'string' && message.html.length <= 65536;
  if (message.type === 'selectionCleared') return Object.keys(message).length === 2;
  if (message.type === 'layerExport') return Object.keys(message).every(key => ['channel', 'type', 'html'].includes(key))
    && typeof message.html === 'string' && message.html.length <= INSPECTOR_LAYER_EXPORT_LIMIT;
  return false;
}

function validStyleSnapshot(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length <= Object.keys(STYLE_RULES).length
    && Object.entries(value).every(([key, style]) => isEditableProperty(key) && typeof style === 'string'
      && style.length <= (styleRule(key).limit ?? DESIGN_STYLE_VALUE_LIMIT));
}

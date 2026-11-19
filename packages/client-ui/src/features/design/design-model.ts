export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const EDITABLE_PROPERTIES = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'gap', 'borderRadius', 'display', 'flexDirection', 'alignItems', 'justifyContent'] as const;
export type EditableProperty = typeof EDITABLE_PROPERTIES[number];
export interface Rect { x: number; y: number; width: number; height: number }
export interface View { x: number; y: number; scale: number }
export interface Point { x: number; y: number }
const tokens = ['--bg-main', '--bg-window', '--bg-card', '--bg-raised', '--bg-inset', '--text-title', '--text-active', '--text-label', '--text-secondary', '--accent-mint', '--accent-amber', '--accent-red'];
export const COLOR_CHOICES = ['transparent', 'currentColor', 'black', 'white', 'inherit', ...tokens.map(token => `var(${token})`)];
const colors = new Set(COLOR_CHOICES);
const unit = '-?(?:0|(?:\\d{1,3}(?:\\.\\d{1,2})?)(?:px|rem|em|%|vh|vw))';
const spacing = new RegExp(`^${unit}(?:\\s+${unit}){0,3}$`);

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

export function resizeRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, width: Math.round(Math.max(80, Math.min(4096, rect.width + dx))), height: Math.round(Math.max(80, Math.min(4096, rect.height + dy))) };
}

export function validateStyleEdit(property: string, value: string): value is string {
  if (!(EDITABLE_PROPERTIES as readonly string[]).includes(property) || value.length > 120 || /[;{}<>\n\r]|url\s*\(|expression|javascript:/i.test(value)) return false;
  if (property === 'color' || property === 'backgroundColor') return colors.has(value) || /^#[0-9a-f]{3,8}$/i.test(value);
  if (property === 'fontWeight') return ['300', '400', '500', '600', '700', '800', 'normal', 'bold'].includes(value);
  if (property === 'display') return ['block', 'flex', 'grid', 'inline', 'inline-flex', 'none'].includes(value);
  if (property === 'flexDirection') return ['row', 'column', 'row-reverse', 'column-reverse'].includes(value);
  if (property === 'alignItems') return ['stretch', 'start', 'center', 'end', 'baseline'].includes(value);
  if (property === 'justifyContent') return ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'].includes(value);
  if (property === 'fontSize') return /^(?:8|9|[1-8][0-9]|96)(?:px|rem|em)$/.test(value);
  if (property === 'margin') return spacing.test(value) && !/^-(?:\d{3,})/.test(value);
  return spacing.test(value);
}

export interface BridgeMessage { channel: string; type: string; [key: string]: unknown }
export function validateBridgeMessage(value: unknown, channel: string): value is BridgeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== channel || typeof message.type !== 'string') return false;
  if (message.type === 'selected') {
    if (Object.keys(message).some(key => !['channel', 'type', 'id', 'tag', 'leaf', 'text', 'styles'].includes(key)) || typeof message.id !== 'string' || !/^n[0-9]{1,10}$/.test(message.id) || typeof message.tag !== 'string' || !/^[a-z0-9]{1,20}$/.test(message.tag) || typeof message.leaf !== 'boolean' || typeof message.text !== 'string' || message.text.length > 500 || !message.styles || typeof message.styles !== 'object' || Array.isArray(message.styles)) return false;
    const styles = message.styles as Record<string, unknown>;
    return Object.keys(styles).length <= EDITABLE_PROPERTIES.length && Object.entries(styles).every(([key, style]) => (EDITABLE_PROPERTIES as readonly string[]).includes(key) && typeof style === 'string' && style.length <= 120);
  }
  if (message.type === 'serialized') return Object.keys(message).every(key => ['channel', 'type', 'html'].includes(key)) && typeof message.html === 'string' && message.html.length <= 65536;
  return false;
}

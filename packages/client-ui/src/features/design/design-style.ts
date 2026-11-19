export {
  DESIGN_COLOR_CHOICES as COLOR_CHOICES, STYLE_RULES, isEditableProperty, validateStyleEdit, type EditableProperty,
} from '@ormicode/protocol';

export function hexFromComputedColor(value: string): string | undefined {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  const rgb = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(0|1|0?\.\d+))?\)$/.exec(value);
  if (!rgb || rgb.slice(1, 4).some(channel => Number(channel) > 255)) return undefined;
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  const alpha = rgb[4] === undefined ? 255 : Math.round(Number(rgb[4]) * 255);
  return '#' + rgb.slice(1, 4).map(channel => toHex(Number(channel))).join('') + (alpha < 255 ? toHex(alpha) : '');
}

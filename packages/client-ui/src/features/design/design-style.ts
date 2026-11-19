const tokens = ['--bg-main', '--bg-window', '--bg-card', '--bg-raised', '--bg-inset', '--text-title', '--text-active', '--text-label', '--text-secondary', '--accent-mint', '--accent-amber', '--accent-red'];
export const COLOR_CHOICES = ['transparent', 'currentColor', 'black', 'white', 'inherit', ...tokens.map(token => 'var(' + token + ')')];

export const STYLE_CHOICES = {
  borderStyle: ['none', 'solid', 'dashed', 'dotted', 'double'],
  display: ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'],
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  alignItems: ['normal', 'stretch', 'start', 'center', 'end', 'baseline', 'flex-start', 'flex-end'],
  justifyContent: ['normal', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'flex-start', 'flex-end'],
  textAlign: ['start', 'left', 'center', 'right', 'end', 'justify'],
  fontWeight: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'],
} as const;

const hex = '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})';
const length = '0|\\d{1,4}(?:\\.\\d{1,3})?(?:px|rem|em|%|vh|vw|ch)';
const lengths = '(?:' + length + ')(?: (?:' + length + ')){0,3}';
const marginLength = '(?:-?(?:' + length + ')|auto)';
const numeric = '\\d{1,3}(?:\\.\\d{1,3})?';
type StyleRule = { choices?: readonly string[]; pattern?: string };

export const STYLE_RULES = {
  color: { pattern: '^' + hex + '$', choices: COLOR_CHOICES },
  backgroundColor: { pattern: '^' + hex + '$', choices: COLOR_CHOICES },
  borderColor: { pattern: '^' + hex + '$', choices: COLOR_CHOICES },
  fontSize: { pattern: '^(?:' + length + ')$' },
  lineHeight: { pattern: '^(?:normal|' + numeric + '|' + length + ')$' },
  width: { pattern: '^(?:auto|min-content|max-content|fit-content|' + length + ')$' },
  height: { pattern: '^(?:auto|min-content|max-content|fit-content|' + length + ')$' },
  padding: { pattern: '^' + lengths + '$' },
  margin: { pattern: '^' + marginLength + '(?: ' + marginLength + '){0,3}$' },
  gap: { pattern: '^(?:normal|(?:' + length + ')(?: (?:' + length + '))?)$' },
  borderRadius: { pattern: '^' + lengths + '(?: / ' + lengths + ')?$' },
  borderWidth: { pattern: '^(?:thin|medium|thick|' + lengths + ')$' },
  opacity: { pattern: '^(?:0(?:\\.\\d{1,3})?|1(?:\\.0{1,3})?|(?:[0-9]{1,2}(?:\\.\\d{1,2})?|100)%)$' },
  borderStyle: { choices: STYLE_CHOICES.borderStyle },
  display: { choices: STYLE_CHOICES.display },
  flexDirection: { choices: STYLE_CHOICES.flexDirection },
  alignItems: { choices: STYLE_CHOICES.alignItems },
  justifyContent: { choices: STYLE_CHOICES.justifyContent },
  textAlign: { choices: STYLE_CHOICES.textAlign },
  fontWeight: { choices: STYLE_CHOICES.fontWeight },
} satisfies Record<string, StyleRule>;

export type EditableProperty = keyof typeof STYLE_RULES;
export const isEditableProperty = (property: string): property is EditableProperty => Object.hasOwn(STYLE_RULES, property);

export function validateStyleEdit(property: string, value: string): boolean {
  if (!isEditableProperty(property) || value.length > 120) return false;
  if (value === '') return true; // remove the inline declaration
  const rule: StyleRule = STYLE_RULES[property];
  return Boolean(rule.choices?.includes(value) || (rule.pattern && new RegExp(rule.pattern).test(value)));
}

export function hexFromComputedColor(value: string): string | undefined {
  if (new RegExp('^' + hex + '$').test(value)) return value;
  const rgb = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(0|1|0?\.\d+))?\)$/.exec(value);
  if (!rgb || rgb.slice(1, 4).some(channel => Number(channel) > 255)) return undefined;
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  const alpha = rgb[4] === undefined ? 255 : Math.round(Number(rgb[4]) * 255);
  return '#' + rgb.slice(1, 4).map(channel => toHex(Number(channel))).join('') + (alpha < 255 ? toHex(alpha) : '');
}

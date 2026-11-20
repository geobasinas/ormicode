export const DESIGN_STYLE_VALUE_LIMIT = 120;
export const DESIGN_IMAGE_VALUE_LIMIT = 8192;
export const DESIGN_TOKEN_PREFIX = '--ormi-design-';
export const DESIGN_TOKEN_NAME_PATTERN = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
export const DESIGN_TOKEN_BINDING_PATTERN = '^var\\(' + DESIGN_TOKEN_PREFIX + '(' + DESIGN_TOKEN_NAME_PATTERN + ')\\)$';
export const DESIGN_DATA_IMAGE_PATTERN = '^url\\("data:image/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}"\\)$';

const themeColors = ['--bg-main', '--bg-window', '--bg-card', '--bg-raised', '--bg-inset', '--text-title', '--text-active', '--text-label', '--text-secondary', '--accent-mint', '--accent-amber', '--accent-red'];
export const DESIGN_COLOR_CHOICES = ['transparent', 'currentColor', 'black', 'white', 'inherit', ...themeColors.map(token => 'var(' + token + ')')];
const hex = '#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})';
const channel = '(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])';
const alpha = '(?:0(?:\\.\\d{1,6})?|1(?:\\.0{1,6})?|\\.\\d{1,6})';
const rgb = 'rgba?\\(' + channel + ', ?' + channel + ', ?' + channel + '(?:, ?' + alpha + ')?\\)';
const number = '\\d{1,5}(?:\\.\\d{1,4})?';
const length = '(?:0|' + number + '(?:px|rem|em|%|vh|vw|ch))';
const lengths = length + '(?: ' + length + '){0,3}';
const offset = '(?:-?' + length + '|auto)';
const family = '[a-zA-Z][a-zA-Z0-9 -]{0,42}';
const font = '(?:' + family + '|"'+family+'"|\'' + family + '\')';
const weight = ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'];
const borderStyle = ['none', 'solid', 'dashed', 'dotted', 'double'];
const alignment = ['normal', 'stretch', 'start', 'center', 'end', 'baseline', 'flex-start', 'flex-end'];
const cssPattern = (expression: string) => '^(?:' + expression + ')$';
const choices = (...values: string[]) => ({ choices: values });
const pattern = (expression: string, ignoreCase = false) => ({ pattern: cssPattern(expression), ignoreCase });
const color = { ...pattern(hex + '|' + rgb, true), choices: DESIGN_COLOR_CHOICES, token: 'color' } as const;
const borderWidth = pattern('thin|medium|thick|' + length);
const size = pattern('auto|min-content|max-content|fit-content|' + length);
const padding = { ...pattern(length), token: 'spacing' } as const;
const gridTrack = '(?:auto|min-content|max-content|' + length + '|' + number + 'fr)';
const grid = pattern('none|' + gridTrack + '(?: ' + gridTrack + '){0,5}|repeat\\((?:[1-9]|1[0-2]), ?' + gridTrack + '\\)');

export const DESIGN_TOKEN_RULES = {
  color: { ...pattern(hex + '|' + rgb, true), choices: ['transparent', 'black', 'white'] },
  opacity: pattern(alpha + '|(?:[0-9]{1,2}(?:\\.\\d{1,2})?|100)%'),
  radius: pattern(lengths + '(?: / ' + lengths + ')?'),
  spacing: pattern(length),
  fontFamily: pattern(font + '(?:, ?' + font + '){0,5}'),
  fontSize: pattern(length),
  fontWeight: { choices: weight },
} as const;

export type DesignTokenKind = keyof typeof DESIGN_TOKEN_RULES;
type StyleRule = { choices?: readonly string[]; pattern?: string; ignoreCase?: boolean; token?: DesignTokenKind; limit?: number };

export const STYLE_RULES = {
  position: choices('static', 'relative', 'absolute', 'fixed', 'sticky'),
  left: pattern(offset), top: pattern(offset),
  rotate: pattern('none|0|-?' + number + 'deg'),
  translate: pattern('none|-?' + length + '(?: -?' + length + ')?'),
  zIndex: pattern('auto|-?\\d{1,6}'),
  width: size, height: size, minWidth: { ...size, token: 'spacing' },
  aspectRatio: pattern('auto|' + number + '(?: / ' + number + ')?'),
  display: choices('block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'none'),
  flexDirection: choices('row', 'column', 'row-reverse', 'column-reverse'),
  flexWrap: choices('nowrap', 'wrap', 'wrap-reverse'),
  flexGrow: pattern(number), flexShrink: pattern(number), flexBasis: pattern('auto|' + length),
  gridTemplateColumns: grid, gridTemplateRows: grid,
  alignSelf: choices('auto', ...alignment),
  alignItems: choices(...alignment),
  justifyItems: choices('normal', 'stretch', 'start', 'center', 'end'),
  justifySelf: choices('auto', 'normal', 'stretch', 'start', 'center', 'end'),
  alignContent: choices('normal', 'stretch', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'),
  justifyContent: choices('normal', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'flex-start', 'flex-end'),
  gap: { ...pattern('normal|' + length + '(?: ' + length + ')?'), token: 'spacing' },
  padding: pattern(lengths), paddingTop: padding, paddingRight: padding, paddingBottom: padding, paddingLeft: padding,
  margin: pattern(offset + '(?: ' + offset + '){0,3}'),
  opacity: { ...DESIGN_TOKEN_RULES.opacity, token: 'opacity' },
  borderRadius: { ...DESIGN_TOKEN_RULES.radius, token: 'radius' },
  overflow: choices('visible', 'hidden', 'clip', 'scroll', 'auto'),
  visibility: choices('visible', 'hidden', 'collapse'),
  color, backgroundColor: color, borderColor: color,
  backgroundImage: { choices: ['none'], pattern: DESIGN_DATA_IMAGE_PATTERN, limit: DESIGN_IMAGE_VALUE_LIMIT },
  backgroundSize: pattern('auto|cover|contain|' + length + '(?: (?:auto|' + length + '))?'),
  backgroundPosition: pattern('(?:left|right|top|bottom|center|' + length + ')(?: (?:left|right|top|bottom|center|' + length + '))?'),
  backgroundRepeat: choices('repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round'),
  objectFit: choices('fill', 'contain', 'cover', 'none', 'scale-down'),
  objectPosition: pattern('(?:left|right|top|bottom|center|-?' + length + ')(?: (?:left|right|top|bottom|center|-?' + length + '))?'),
  borderWidth: pattern('thin|medium|thick|' + lengths), borderStyle: { choices: borderStyle },
  borderTopWidth: borderWidth, borderRightWidth: borderWidth, borderBottomWidth: borderWidth, borderLeftWidth: borderWidth,
  borderTopStyle: { choices: borderStyle }, borderRightStyle: { choices: borderStyle },
  borderBottomStyle: { choices: borderStyle }, borderLeftStyle: { choices: borderStyle },
  borderTopColor: color, borderRightColor: color, borderBottomColor: color, borderLeftColor: color,
  fontFamily: { ...DESIGN_TOKEN_RULES.fontFamily, token: 'fontFamily' },
  fontSize: { ...DESIGN_TOKEN_RULES.fontSize, token: 'fontSize' },
  fontWeight: { ...DESIGN_TOKEN_RULES.fontWeight, token: 'fontWeight' },
  lineHeight: pattern('normal|' + number + '|' + length),
  textAlign: choices('start', 'left', 'center', 'right', 'end', 'justify'),
} satisfies Record<string, StyleRule>;

export type EditableProperty = keyof typeof STYLE_RULES;
export type DesignStylePatch = Partial<Record<EditableProperty, string>>;

export const isEditableProperty = (property: string): property is EditableProperty => Object.hasOwn(STYLE_RULES, property);
export const styleRule = (property: EditableProperty): StyleRule => STYLE_RULES[property];
export const designTokenName = (value: string) => value.length <= 40 && value.trim() === value && new RegExp('^' + DESIGN_TOKEN_NAME_PATTERN + '$').test(value);
export const designTokenBinding = (name: string) => 'var(' + DESIGN_TOKEN_PREFIX + name + ')';
export const boundDesignToken = (value: string) => new RegExp(DESIGN_TOKEN_BINDING_PATTERN).exec(value)?.[1];

function matchesStyleRule(rule: StyleRule, value: string): boolean {
  return Boolean(rule.choices?.includes(value) || (rule.pattern && new RegExp(rule.pattern, rule.ignoreCase ? 'i' : '').test(value)));
}

export function validateStyleEdit(property: string, value: string): boolean {
  if (!isEditableProperty(property) || typeof value !== 'string' || /[\r\n]/.test(value)) return false;
  const rule = styleRule(property);
  if (value.length > (rule.limit ?? DESIGN_STYLE_VALUE_LIMIT)) return false;
  const binding = boundDesignToken(value);
  return value === '' || (binding ? Boolean(rule.token && designTokenName(binding)) : matchesStyleRule(rule, value));
}

export function validateDesignTokenValue(kind: DesignTokenKind, value: string): boolean {
  return value.length <= DESIGN_STYLE_VALUE_LIMIT && !/[\r\n]/.test(value) && matchesStyleRule(DESIGN_TOKEN_RULES[kind], value);
}

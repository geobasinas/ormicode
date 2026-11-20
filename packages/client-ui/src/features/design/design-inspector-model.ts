import { DESIGN_TOKEN_PREFIX, designTokenSchema, validateStyleEdit, type DesignToken } from '@ormicode/protocol';

export type ElementGeometry = { width: number; height: number; parentLayout: string; parentDirection?: string };
export type LayerAxis = 'x' | 'y';
export type LayerAlignment = 'start' | 'center' | 'end';

export function validElementGeometry(value: unknown): value is ElementGeometry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { width, height, parentLayout, parentDirection, ...extra } = value as Record<string, unknown>;
  return Object.keys(extra).length === 0 && typeof width === 'number' && width >= 0 && width <= 100000
    && typeof height === 'number' && height >= 0 && height <= 100000
    && typeof parentLayout === 'string' && /^[a-z -]{0,40}$/.test(parentLayout)
    && (parentDirection === undefined || (typeof parentDirection === 'string' && /^(?:(?:row|column)(?:-reverse)?)?$/.test(parentDirection)));
}

export function renderDesignTokenStyles(tokens: readonly DesignToken[] = []): string {
  if (!tokens.length) return '';
  const declarations = tokens.flatMap(item => designTokenSchema.safeParse(item).success
    ? [`${DESIGN_TOKEN_PREFIX}${item.name}:${item.value}`] : []);
  return declarations.length ? `:root{${declarations.join(';')}}` : '';
}

const layerPath = /^\d{1,5}(?:\.\d{1,5}){0,23}$/;

/** Positional fallback scoped to the selected frame and revision. Reordering can change a path.
 * The token binding itself is stored in the element's inline style and travels with the markup. */
export function frameMarkupWithToken(cleanHtml: string, path: string, tag: string, property: string, value: string): string | undefined {
  if (!layerPath.test(path) || !validateStyleEdit(property, value)) return undefined;
  const root = document.implementation.createHTMLDocument().createElement('div');
  root.innerHTML = cleanHtml;
  let current: ParentNode | undefined = root;
  for (const index of path.split('.')) current = current?.children[Number(index)];
  if (!(current instanceof HTMLElement || current instanceof SVGElement) || current.localName !== tag) return undefined;
  current.style.setProperty(property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value);
  return root.innerHTML;
}

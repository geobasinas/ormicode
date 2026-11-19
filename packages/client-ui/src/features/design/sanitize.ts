import createDOMPurify from 'dompurify';
import { constrainSvg, MAX_SVG_SOURCE, SVG_GEOMETRY_ATTRS, SVG_NS } from './vector-svg.ts';

const DOMPurify = createDOMPurify(window);

export const SANITIZE_CONFIG: NonNullable<Parameters<typeof DOMPurify.sanitize>[1]> = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'select', 'textarea', 'a', 'area', 'base', 'meta', 'link', 'video', 'audio', 'source'],
  FORBID_ATTR: ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'download', 'ping', 'autofocus', 'contenteditable'],
  ALLOW_DATA_ATTR: false,
  ADD_URI_SAFE_ATTR: SVG_GEOMETRY_ATTRS,
  ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i,
};

export function sanitizeMarkup(input: string): string {
  const template = parseMarkup(input);
  return template.innerHTML;
}

function parseMarkup(input: string, config = SANITIZE_CONFIG): HTMLTemplateElement {
  const fragment = DOMPurify.sanitize(input, { ...config, RETURN_DOM_FRAGMENT: true });
  constrainSvg(fragment);
  const template = window.document.createElement('template');
  template.content.append(fragment);
  return template;
}

export function standaloneSvg(input: string): SVGSVGElement | null {
  if (input.length > MAX_SVG_SOURCE) return null;
  const { content } = parseMarkup(input.trim());
  const svg = content.firstElementChild;
  return content.childNodes.length === 1 && svg?.namespaceURI === SVG_NS && svg.localName === 'svg' ? svg as SVGSVGElement : null;
}

export function sanitizeLayerMarkup(input: string): string {
  return parseMarkup(input, { ...SANITIZE_CONFIG, FORBID_TAGS: [...SANITIZE_CONFIG.FORBID_TAGS!, 'style', 'template'] }).innerHTML;
}

import { DESIGN_PROTOTYPE_ATTRIBUTE, isDesignPrototypeAction } from '@ormicode/protocol';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MAX_SVG_SOURCE = 12288;
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const token = new RegExp(`^${NUMBER}$`, 'i');
const scalar = (value: string) => token.test(value) && Math.abs(Number(value)) <= 1e6;
const length = (value: string) => scalar(value.replace(/%$/, ''));
const numbers = (value: string) => value.trim().split(/[\s,]+/);
const paint = (value: string) => /^(?:#[0-9a-f]{3,8}|[a-z]{1,24})$/i.test(value);
const choice = (...values: string[]) => (value: string) => values.includes(value);
const pathTokens = new RegExp(`[MmZzLlHhVvCcSsQqTtAa]|${NUMBER}|[\\s,]+`, 'gi');
const path = (value: string) => value.length <= 8192 && !value.replace(pathTokens, '') &&
  (value.match(new RegExp(NUMBER, 'gi')) ?? []).every(scalar);
const coords = (count: number, positive = false) => (value: string) => {
  const values = numbers(value);
  return values.length === count && values.every(scalar) && (!positive || values.slice(2).every(n => Number(n) > 0));
};
const points = (value: string) => {
  const values = numbers(value);
  return values.length >= 4 && values.length <= 1024 && values.length % 2 === 0 && values.every(scalar);
};
const transform = (value: string) => value.length <= 320 && !value.replace(
  /(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)[\s,]*/g,
  (match, type: string, body: string) => {
    const values = numbers(body);
    const counts = type === 'matrix' ? [6] : type === 'rotate' ? [1, 3] : type === 'translate' || type === 'scale' ? [1, 2] : [1];
    return counts.includes(values.length) && values.every(scalar) ? '' : match;
  },
).trim();
const opacity = (value: string) => scalar(value) && Number(value) >= 0 && Number(value) <= 1;
const common = new Map<string, (value: string) => boolean>(Object.entries({
  fill: paint, stroke: paint, 'stroke-width': length, opacity, 'fill-opacity': opacity, 'stroke-opacity': opacity,
  'stroke-linecap': choice('butt', 'round', 'square'), 'stroke-linejoin': choice('miter', 'round', 'bevel'),
  'fill-rule': choice('nonzero', 'evenodd'), transform,
}));
const geometry = new Map(Object.entries({
  svg: 'x y width height', g: '', rect: 'x y width height rx ry', circle: 'cx cy r',
  ellipse: 'cx cy rx ry', line: 'x1 y1 x2 y2', polyline: '', polygon: '', path: '', title: '', desc: '',
}).map(([tag, values]) => [tag, new Set(values.split(' ').filter(Boolean))]));

export const SVG_GEOMETRY_ATTRS = [
  ...new Set([...common.keys(), ...Array.from(geometry.values()).flatMap(attrs => [...attrs]), 'd', 'points', 'viewbox', 'preserveaspectratio']),
];

function validAttribute(tag: string, attr: Attr) {
  if (attr.namespaceURI) return false;
  const { name, value } = attr;
  if (name === DESIGN_PROTOTYPE_ATTRIBUTE) return isDesignPrototypeAction(value);
  if (common.has(name)) return common.get(name)!(value);
  if (geometry.get(tag)?.has(name)) return length(value);
  if (tag === 'path' && name === 'd') return path(value);
  if ((tag === 'polyline' || tag === 'polygon') && name === 'points') return points(value);
  if (tag === 'svg' && name === 'viewBox') return coords(4, true)(value);
  if (tag === 'svg' && name === 'preserveAspectRatio') {
    return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value);
  }
  return false;
}

export function constrainSvg(fragment: DocumentFragment) {
  for (const template of fragment.querySelectorAll('template')) constrainSvg(template.content);
  let remaining = 128;
  function clean(el: Element, depth: number) {
    const tag = el.localName;
    if (--remaining < 0 || depth > 12 || el.namespaceURI !== SVG_NS || !geometry.has(tag) || (tag === 'svg' && depth !== 0)) {
      el.remove(); return;
    }
    for (const attr of Array.from(el.attributes)) if (!validAttribute(tag, attr)) el.removeAttributeNode(attr);
    if (tag === 'title' || tag === 'desc') {
      el.textContent = (el.textContent ?? '').slice(0, 240);
      return;
    }
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1) clean(node as Element, depth + 1);
      else node.remove();
    }
  }
  for (const el of fragment.querySelectorAll('svg')) if (!el.parentElement?.closest('svg')) clean(el, 0);
}

export function svgViewBox(svg: Element) {
  const value = svg.getAttribute('viewBox');
  if (value && coords(4, true)(value)) {
    const [x, y, width, height] = numbers(value).map(Number);
    return { x: x!, y: y!, width: width!, height: height! };
  }
  const size = (name: string, fallback: number) => {
    const dimension = svg.getAttribute(name);
    return dimension && scalar(dimension) && Number(dimension) > 0 ? Number(dimension) : fallback;
  };
  return { x: 0, y: 0, width: size('width', 240), height: size('height', 160) };
}

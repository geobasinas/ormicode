import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Frame, Image as ImageIcon, Layers3, MousePointer2, Scan, Search, Smartphone, Star, Type } from 'lucide-react';
import type { DesignFrame } from '@ormicode/protocol';
import { sanitizeMarkup } from './sanitize.ts';

interface Layer { path: string; depth: number; tag: string; label: string; title: string }

const TEXT_TAGS = new Set(['span', 'p', 'label', 'li', 'strong', 'em', 'small', 'code', 'pre', 'blockquote', 'figcaption']);
const FRAME_TAGS = new Set(['section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure']);

/** Visible layer name. Raw tags such as div/span/section become text, an accessible name, or a friendly type. */
export function layerLabel(element: Element): { label: string; title: string } {
  const tag = element.localName;
  const text = visibleText(element);
  const id = element.id.trim();
  const aria = element.getAttribute('aria-label')?.trim() ?? '';
  const dataName = element.getAttribute('data-name')?.trim() ?? '';
  const alt = element.getAttribute('alt')?.trim() ?? '';
  const label = clip(text || id || aria || dataName || alt || friendlyType(element) || tag);
  return { label, title: `<${tag}> ${label}` };
}

export function adjacentLayerRow(rows: readonly HTMLElement[], active: Element | null, key: 'ArrowUp' | 'ArrowDown'): HTMLElement | undefined {
  if (!active) return;
  let index = rows.findIndex(row => row === active || row.contains(active));
  if (index < 0) {
    const frame = active.closest('.design-frame-row');
    if (frame) index = rows.findIndex(row => frame.contains(row));
  }
  if (index < 0) return;
  return rows[index + (key === 'ArrowDown' ? 1 : -1)];
}

export function readLayers(html: string): Layer[] {
  const dataNames = rememberNames(html);
  const template = window.document.createElement('template');
  template.innerHTML = sanitizeMarkup(html);
  const layers: Layer[] = [];
  function visit(children: HTMLCollection, parent: string, depth: number) {
    if (depth >= 24) return;
    for (let index = 0; index < children.length && layers.length < 300; index++) {
      const element = children[index]!;
      if (element.localName === 'style' || element.localName === 'template') continue;
      const path = parent ? parent + '.' + index : String(index);
      const saved = dataNames.get(path);
      if (saved && saved.tag === element.localName && !element.getAttribute('data-name')) element.setAttribute('data-name', saved.name);
      const named = layerLabel(element);
      layers.push({ path, depth, tag: element.localName, label: named.label, title: named.title });
      visit(element.children, path, depth + 1);
    }
  }
  visit(template.content.children, '', 0);
  return layers;
}

function clip(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function visibleText(element: Element): string {
  const readsNested = /^(button|h[1-6])$/.test(element.localName) || TEXT_TAGS.has(element.localName);
  if (!readsNested && element.children.length) return '';
  return clip(element.textContent ?? '');
}

function friendlyType(element: Element): string {
  const tag = element.localName;
  if (/^h[1-6]$/.test(tag)) return 'Heading';
  if (tag === 'button') return 'Button';
  if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'canvas') return 'Image';
  if (tag === 'ul' || tag === 'ol' || tag === 'g') return 'Group';
  if (tag === 'div') return element.children.length ? 'Frame' : 'Rectangle';
  if (TEXT_TAGS.has(tag)) return 'Text';
  if (FRAME_TAGS.has(tag)) return 'Frame';
  return '';
}

function rememberNames(html: string): Map<string, { tag: string; name: string }> {
  const template = window.document.createElement('template');
  template.innerHTML = html;
  const names = new Map<string, { tag: string; name: string }>();
  const visit = (children: HTMLCollection, parent: string, depth: number) => {
    if (depth >= 24) return;
    for (let index = 0; index < children.length && names.size < 300; index++) {
      const element = children[index]!;
      if (element.localName === 'style' || element.localName === 'template') continue;
      const path = parent ? parent + '.' + index : String(index);
      const name = element.getAttribute('data-name')?.trim();
      if (name) names.set(path, { tag: element.localName, name: name.slice(0, 80) });
      visit(element.children, path, depth + 1);
    }
  };
  visit(template.content.children, '', 0);
  return names;
}

function layerIcon(tag: string) {
  if (tag === 'button') return MousePointer2;
  if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'canvas') return ImageIcon;
  if (/^h[1-6]$/.test(tag) || TEXT_TAGS.has(tag)) return Type;
  if (FRAME_TAGS.has(tag)) return Frame;
  return Layers3;
}

function onLayerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.altKey || event.ctrlKey || event.metaKey) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.design-frame-row .design-layer-name, .design-element-row')];
  const next = adjacentLayerRow(rows, document.activeElement, event.key);
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export function DesignLayers({ frames, activeFrame, activePath, workingFrame, onFrame, onElement, onReveal, selectedIds, onFrameClick, frameControls, onReorder }: {
  frames: DesignFrame[];
  activeFrame?: DesignFrame;
  activePath?: string;
  workingFrame?: string | null;
  onFrame(id: string): boolean;
  onElement(frameId: string, path: string): void;
  onReveal(frame: DesignFrame): void;
  selectedIds?: string[];
  onFrameClick?(event: MouseEvent, frame: DesignFrame): boolean;
  frameControls?(frame: DesignFrame): ReactNode;
  onReorder?(dragId: string, targetId: string): void;
}) {
  const [dragging, setDragging] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [search, setSearch] = useState('');
  const [folded, setFolded] = useState('');
  const query = search.trim().toLowerCase();
  const results = useMemo(() => (query ? frames : activeFrame ? [activeFrame] : []).map(frame => ({
    frame, layers: readLayers(frame.html),
  })), [frames, activeFrame, query]);
  return <section className="design-layers" aria-label="Design layers">
    <div className="design-section-heading"><Layers3 size={13} /><span>Layers</span><small>{frames.length}</small></div>
    {frames.length ? <label className="design-layer-search"><Search size={13} /><input aria-label="Search layers" placeholder="Find a layer…" value={search} onChange={event => setSearch(event.target.value)} /></label> : null}
    <div className="design-layer-list" onKeyDown={onLayerKeyDown}>
      {frames.map(frame => {
        const children = results.find(item => item.frame.id === frame.id)?.layers ?? [];
        const matches = query ? children.filter(layer => layer.label.toLowerCase().includes(query) || layer.tag.includes(query)) : children;
        if (query && !frame.name.toLowerCase().includes(query) && !matches.length) return null;
        const active = frame.id === activeFrame?.id;
        const expanded = query ? matches.length > 0 : active && folded !== frame.id;
        const Device = frame.width < 600 ? Smartphone : Frame;
        const Chevron = expanded ? ChevronDown : ChevronRight;
        return <div key={frame.id}>
          <div className="design-frame-row" data-active={active} data-secondary={!active && selectedIds?.includes(frame.id)} data-hidden={!!frame.hidden} data-drop={dropTarget === frame.id}
            draggable={!!onReorder && !query} onDragStart={event => { setDragging(frame.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(''); setDropTarget(''); }}
            onDragOver={event => { if (dragging) { event.preventDefault(); setDropTarget(frame.id); } }} onDrop={event => { if (!dragging) return; event.preventDefault(); onReorder?.(dragging, frame.id); setDragging(''); setDropTarget(''); }}>
            <button className="design-icon-button design-fold" type="button" aria-label={expanded ? 'Collapse ' + frame.name : 'Expand ' + frame.name}
              aria-expanded={expanded} onClick={() => { if (active || onFrame(frame.id)) setFolded(expanded ? frame.id : ''); }}><Chevron size={13} /></button>
            <button className="design-layer-name" type="button" aria-pressed={active} title={frame.name} onClick={event => { if (onFrameClick?.(event, frame)) return; if (onFrame(frame.id)) setFolded(''); }} onDoubleClick={() => onReveal(frame)}><Device size={14} /><span>{frame.name}</span></button>
            {workingFrame === frame.id ? <Star className="design-working-star" size={11} aria-label="Working direction" /> : null}
            {frameControls?.(frame)}
            <button className="design-icon-button design-reveal" type="button" title={'Fit ' + frame.name} aria-label={'Fit ' + frame.name} onClick={() => onReveal(frame)}><Scan size={13} /></button>
          </div>
          {expanded ? matches.map(layer => {
            const Icon = layerIcon(layer.tag);
            return <button key={layer.path} type="button" className="design-layer-name design-element-row" aria-pressed={active && layer.path === activePath}
              title={layer.title} onClick={() => onElement(frame.id, layer.path)}
              style={{ paddingLeft: 30 + (query ? 0 : Math.min(layer.depth, 7)) * 11 }}>
              <Icon size={12} /><span>{layer.label}</span>
            </button>;
          }) : null}
        </div>;
      })}
      {!frames.length ? <p className="design-muted design-list-note">Frames and elements appear here.</p> : null}
      {query && !results.some(({ frame, layers }) => frame.name.toLowerCase().includes(query) || layers.some(layer => layer.label.toLowerCase().includes(query) || layer.tag.includes(query))) ? <p className="design-muted design-list-note">No matching layers.</p> : null}
    </div>
  </section>;
}

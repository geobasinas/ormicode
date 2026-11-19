import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Frame, Layers3, MousePointer2, Scan, Search, Smartphone, Star, Type } from 'lucide-react';
import type { DesignFrame } from '@ormicode/protocol';
import { sanitizeMarkup } from './sanitize.ts';

interface Layer { path: string; depth: number; tag: string; label: string }

export function readLayers(html: string): Layer[] {
  const template = window.document.createElement('template');
  template.innerHTML = sanitizeMarkup(html);
  const layers: Layer[] = [];
  function visit(children: HTMLCollection, parent: string, depth: number) {
    if (depth >= 24) return;
    for (let index = 0; index < children.length && layers.length < 300; index++) {
      const element = children[index]!;
      if (element.localName === 'style' || element.localName === 'template') continue;
      const path = parent ? parent + '.' + index : String(index);
      const tag = element.localName;
      const content = !element.children.length ? (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) : '';
      layers.push({ path, depth, tag, label: content || (element.id ? '#' + element.id : tag) });
      visit(element.children, path, depth + 1);
    }
  }
  visit(template.content.children, '', 0);
  return layers;
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
    <div className="design-layer-list">
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
            <button className="design-layer-name" type="button" aria-pressed={active} onClick={event => { if (onFrameClick?.(event, frame)) return; if (onFrame(frame.id)) setFolded(''); }} onDoubleClick={() => onReveal(frame)}><Device size={14} /><span>{frame.name}</span></button>
            {workingFrame === frame.id ? <Star className="design-working-star" size={11} aria-label="Working direction" /> : null}
            {frameControls?.(frame)}
            <button className="design-icon-button design-reveal" type="button" title={'Fit ' + frame.name} aria-label={'Fit ' + frame.name} onClick={() => onReveal(frame)}><Scan size={13} /></button>
          </div>
          {expanded ? matches.map(layer => {
            const Icon = layer.tag === 'button' ? MousePointer2 : /^h[1-6]$|^p$|^span$/.test(layer.tag) ? Type : Layers3;
            return <button key={layer.path} type="button" className="design-layer-name design-element-row" aria-pressed={active && layer.path === activePath}
              title={'<' + layer.tag + '> ' + layer.label} onClick={() => onElement(frame.id, layer.path)}
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

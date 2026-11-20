import { useMemo, useState } from 'react';
import { ChevronDown, Shapes } from 'lucide-react';
import type { DesignDocument, DesignFrame, DesignOperation } from '@ormicode/protocol';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { DesignArtworkEditor, inspectArtwork, type ArtworkEdit } from './DesignArtworkEditor.tsx';
import { DesignVectorDrawing, type Artwork } from './DesignVectorDrawing.tsx';
import { clampPosition, type View } from './design-model.ts';
import { standaloneSvg } from './sanitize.ts';
import { documentPoint, type DrawTool } from './vector-geometry.ts';
import { richBody, RICH_STYLES } from './vector-rich-text.ts';
import { svgViewBox } from './vector-svg.ts';
import './design-vector.css';

type Props = {
  owner: DesignDocument | null; scope: string; frame?: DesignFrame; enabled: boolean;
  view: View; size: { width: number; height: number };
  onCommit(operation: DesignOperation): Promise<boolean>; onError(message: string): void;
};
type Mode = { tool: DrawTool } | { edit: ArtworkEdit };
const tools: [DrawTool, string][] = [
  ['rectangle', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['freehand', 'Freehand'], ['pen', 'Bézier pen'],
];

export function useDesignArtwork({ owner, scope, frame, enabled, view, size, onCommit, onError }: Props) {
  const [pending, setPending] = useState<{ owner: DesignDocument | null; scope: string; mode: Mode }>();
  const mode = pending && pending.owner === owner && pending.scope === scope ? pending.mode : undefined;
  const setMode = (mode: Mode) => setPending({ owner, scope, mode });
  const clear = () => setPending(undefined);
  const artwork = useMemo(() => frame && ({ ...inspectArtwork(frame.html), rich: richBody(frame.html) }), [frame]);
  const draw = mode && 'tool' in mode ? mode.tool : undefined;
  const edit = mode && 'edit' in mode ? mode.edit : undefined;
  const open = (edit: ArtworkEdit) => setMode({ edit });
  const close = () => setPending(current => current === pending ? undefined : current);

  const add = (art: Artwork) => onCommit({ type: 'frame.add', ...art });
  const save = (html: string): Promise<boolean> => {
    if (!edit || !enabled) return Promise.resolve(false);
    if (edit.frame) return onCommit({ type: 'frame.update', frameId: edit.frame.id, patch: { html } });
    const svg = edit.kind === 'svg' ? standaloneSvg(html) : null;
    const viewBox = svg ? svgViewBox(svg) : null;
    const dimension = (value: number) => Math.min(4096, Math.max(80, Math.ceil(value)));
    const width = dimension(viewBox?.width ?? 280), height = dimension(viewBox?.height ?? 160);
    const center = documentPoint({ x: size.width / 2, y: size.height / 2 }, { x: 0, y: 0 }, view);
    return add({ name: svg ? 'SVG' : 'Rich text', html, styles: svg ? '' : RICH_STYLES,
      width, height, x: clampPosition(center.x - width / 2), y: clampPosition(center.y - height / 2) });
  };

  return {
    clear, drawing: Boolean(draw),
    overlay: enabled && draw ? <DesignVectorDrawing key={draw} tool={draw} view={view} onCancel={clear} onError={onError}
      onFinish={art => { close(); void add(art); }} /> : null,
    toolbar: <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="design-icon-button design-vector-trigger"
          title="Drawing and rich text" aria-label="Drawing and rich text" data-active={Boolean(draw)} disabled={!enabled}>
          <Shapes size={16} /><ChevronDown size={13} />
        </button></DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          {tools.map(([tool, label]) => <DropdownMenuItem key={tool} onSelect={() => setMode({ tool })}>{label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => open({ kind: 'svg', source: '<svg viewBox="0 0 120 100">\n  <rect x="10" y="10" width="100" height="80" rx="10" fill="#a1a1aa"/>\n</svg>' })}>Insert SVG…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open({ kind: 'rich', source: '<p>Write something</p>' })}>Add rich text…</DropdownMenuItem>
          {frame && (artwork?.svg || artwork?.rich != null) && <DropdownMenuSeparator />}
          {frame && artwork?.svg && <DropdownMenuItem onSelect={() => open({ kind: 'svg', frame, source: artwork.svg! })}>Edit selected SVG…</DropdownMenuItem>}
          {frame && artwork?.svg && artwork.path && <DropdownMenuItem onSelect={() => open({ kind: 'path', frame, source: artwork.svg!, path: artwork.path! })}>Edit selected path…</DropdownMenuItem>}
          {frame && artwork?.rich != null && <DropdownMenuItem onSelect={() => open({ kind: 'rich', frame, source: artwork.rich! })}>Edit selected rich text…</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {edit && <DesignArtworkEditor edit={edit} onClose={close} onSave={save} />}
    </>,
  };
}

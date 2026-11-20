import { useId, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
} from 'lucide-react';
import type { DesignStylePatch, EditableProperty } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import type { LayerAlignment, LayerAxis } from './design-inspector-model.ts';

type Dimension = 'width' | 'height';
const modes = { fixed: 'Fixed', auto: 'Auto', fill: 'Fill', hug: 'Hug' } as const;
type SizingMode = keyof typeof modes;
const alignControls = [
  ['x', 'start', 'Align left', AlignStartVertical], ['x', 'center', 'Center horizontally', AlignCenterVertical], ['x', 'end', 'Align right', AlignEndVertical],
  ['y', 'start', 'Align top', AlignStartHorizontal], ['y', 'center', 'Center vertically', AlignCenterHorizontal], ['y', 'end', 'Align bottom', AlignEndHorizontal],
] as const;

function sizeMode(value: string | undefined): SizingMode {
  if (!value || value === 'auto') return 'auto';
  if (value === '100%') return 'fill';
  if (['max-content', 'fit-content', 'min-content'].includes(value)) return 'hug';
  return 'fixed';
}

export function DesignLayerGeometry({ element, disabled, field, onStyle, onAlign }: {
  element: ElementSelection;
  disabled: boolean;
  field(property: EditableProperty, label: string, onCommit?: (value: string) => void, wide?: boolean): ReactNode;
  onStyle(value: DesignStylePatch): void;
  onAlign(axis: LayerAxis, alignment: LayerAlignment): void;
}) {
  const sizingId = useId();
  const position = element.computed.position || element.styles.position || 'static';
  const inlineLayout = element.computed.display === 'inline' && element.tag !== 'img' ? { display: 'inline-block' } : {};
  const flexAxis = element.geometry?.parentLayout.includes('flex')
    ? (element.geometry.parentDirection?.startsWith('column') ? 'height' : 'width') : undefined;
  const ratio = element.styles.aspectRatio || element.computed.aspectRatio || 'auto';
  const locked = ratio !== 'auto';
  const pixels = (axis: Dimension) => {
    const value = element.computed[axis] ?? '';
    if (/^\d{1,5}(\.\d{1,4})?px$/.test(value)) return Number.parseFloat(value);
    return element.geometry?.[axis] ?? 0;
  };
  const editPosition = (property: 'left' | 'top' | 'zIndex', value: string) => onStyle({
    ...(value && value !== 'auto' && position === 'static' ? { position: 'relative' } : {}),
    [property]: property !== 'zIndex' && /^-?\d+(?:\.\d+)?$/.test(value) ? value + 'px' : value,
  });
  const editDimension = (axis: Dimension, value: string, mode = sizeMode(value)) => {
    const other = axis === 'width' ? 'height' : 'width';
    const unitValue = /^\d+(?:\.\d+)?$/.test(value) ? value + 'px' : value;
    const fillFlex = axis === flexAxis && mode === 'fill';
    const forceAuto = locked && unitValue && unitValue !== 'auto' && mode !== 'hug';
    let flex: DesignStylePatch = {};
    if (axis === flexAxis) {
      flex = !value ? { flexGrow: '', flexShrink: '', flexBasis: '' } : {
        flexGrow: fillFlex ? '1' : '0', flexShrink: mode === 'auto' || fillFlex ? '1' : '0', flexBasis: fillFlex ? '0px' : 'auto',
      };
    }
    onStyle({ ...(unitValue && unitValue !== 'auto' ? inlineLayout : {}), ...flex,
      [axis]: fillFlex ? 'auto' : unitValue, ...(forceAuto ? { [other]: 'auto' } : {}) });
  };
  const setSizeMode = (axis: Dimension, mode: SizingMode) => {
    const values = { fixed: Math.min(99999, pixels(axis)) + 'px', auto: 'auto', fill: '100%', hug: 'max-content' };
    editDimension(axis, values[mode], mode);
  };
  const toggleAspect = () => {
    if (locked) { onStyle({ aspectRatio: 'auto' }); return; }
    const dimension = (axis: Dimension) => Math.min(99999, pixels(axis)).toFixed(4);
    onStyle({ ...inlineLayout, aspectRatio: dimension('width') + ' / ' + dimension('height'), height: 'auto' });
  };
  return <>
    <section className="design-properties">
      <h3>Position</h3>
      <div className="design-inspector-align" role="group" aria-label="Align within parent">
        {alignControls.map(([axis, alignment, label, Icon]) => <button type="button" className="design-icon-button" key={label}
          aria-label={label} title={label} disabled={disabled} onClick={() => onAlign(axis, alignment)}><Icon size={14} /></button>)}
      </div>
      <div className="design-field-grid">
        {field('left', 'X offset', value => editPosition('left', value))}
        {field('top', 'Y offset', value => editPosition('top', value))}
        {field('rotate', 'Rotation', value => onStyle({ rotate: /^-?\d+(?:\.\d+)?$/.test(value) ? value + 'deg' : value }))}
        {field('zIndex', 'Stack order', value => editPosition('zIndex', value))}
        {field('position', 'Position mode', undefined, true)}
      </div>
    </section>
    <section className="design-properties">
      <h3>Size</h3>
      <div className="design-field-grid">
        {(['width', 'height'] as const).map(axis => {
          const label = axis === 'width' ? 'Width' : 'Height';
          const growing = Number(element.styles.flexGrow || element.computed.flexGrow || 0) > 0;
          const mode = axis === flexAxis && growing ? 'fill' : sizeMode(element.styles[axis]);
          return <div className="design-inspector-sizing" key={axis}>
            <label className="design-inspector-subheading" htmlFor={sizingId + axis}>{label} mode</label>
            <select id={sizingId + axis} className="design-input ormi-select" value={mode} disabled={disabled}
              onChange={event => setSizeMode(axis, event.currentTarget.value as SizingMode)}>
              {Object.entries(modes).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            {field(axis, label, value => editDimension(axis, value))}
          </div>;
        })}
        {field('minWidth', 'Minimum width')}
        <label className="design-inspector-aspect"><input type="checkbox" checked={locked} onChange={toggleAspect}
          disabled={disabled || (!locked && (pixels('width') <= 0 || pixels('height') <= 0))} /> Lock aspect ratio</label>
      </div>
    </section>
  </>;
}

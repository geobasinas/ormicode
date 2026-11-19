import { type ReactNode } from 'react';
import type { DesignStylePatch, DesignToken, EditableProperty } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { DesignStyleField } from './DesignStyleField.tsx';
import { DesignLayerGeometry } from './DesignLayerGeometry.tsx';
import { DesignBackgroundImage } from './DesignBackgroundImage.tsx';
import type { LayerAlignment, LayerAxis } from './design-inspector-model.ts';

type Field = readonly [EditableProperty, string];
const padding: Field[] = [['paddingTop', 'Top'], ['paddingRight', 'Right'], ['paddingBottom', 'Bottom'], ['paddingLeft', 'Left']];
const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;

type Props = {
  element: ElementSelection;
  disabled: boolean;
  tokens: readonly DesignToken[];
  onStyle(patch: DesignStylePatch): void;
  onAlign(axis: LayerAxis, alignment: LayerAlignment): void;
  onCreateToken(property: EditableProperty, token: DesignToken): void;
  onUpdateToken(token: DesignToken): void;
  onExport(): void;
};

export function DesignElementStyles({ element, disabled, tokens, onStyle, onAlign, onCreateToken, onUpdateToken, onExport }: Props) {
  const display = element.computed.display || element.styles.display || '';
  const flex = display.includes('flex');
  const grid = display.includes('grid');
  const parentLayout = element.geometry?.parentLayout ?? '';
  const field = (property: EditableProperty, label: string, onCommit?: (value: string) => void, wide = false) => (
    <DesignStyleField key={property} property={property} label={label} inline={element.styles[property] ?? ''}
      computed={element.computed[property] ?? ''} disabled={disabled} tokens={tokens} canCreateToken={Boolean(element.path)}
      className={wide ? 'design-inspector-field-wide' : undefined}
      onCommit={value => { if (value !== (element.styles[property] ?? '')) (onCommit ?? (next => onStyle({ [property]: next })))(value); }}
      onCreateToken={token => onCreateToken(property, token)} onUpdateToken={onUpdateToken} />
  );
  return <div className="design-element-inspector">
    <DesignLayerGeometry element={element} disabled={disabled} field={field} onStyle={onStyle} onAlign={onAlign} />
    <Section title="Layout">
      <div className="design-field-grid">
        {field('display', 'Display')}
        {flex ? field('flexDirection', 'Direction') : null}
        {flex ? field('flexWrap', 'Wrap') : null}
        {grid ? field('gridTemplateColumns', 'Columns') : null}
        {grid ? field('gridTemplateRows', 'Rows') : null}
        {flex || grid ? <>
          {field('alignItems', 'Align items')}
          {field('justifyContent', 'Justify content')}
          {field('alignContent', 'Align content')}
          {field('gap', 'Gap')}
        </> : null}
        {grid ? field('justifyItems', 'Justify items') : null}
        {parentLayout.includes('flex') || parentLayout.includes('grid') ? field('alignSelf', 'Align self') : null}
        {parentLayout.includes('grid') ? field('justifySelf', 'Justify self') : null}
      </div>
      <div className="design-inspector-subheading">Padding</div>
      <div className="design-field-grid">{padding.map(([property, side]) => field(property, side + ' padding'))}</div>
      <div className="design-field-grid">{field('margin', 'Margin')}</div>
    </Section>
    <Section title="Appearance">
      <div className="design-field-grid">
        {field('opacity', 'Opacity')}
        {field('borderRadius', 'Corner radius')}
        {field('overflow', 'Clip content')}
        {field('visibility', 'Visibility')}
      </div>
    </Section>
    <Section title="Fill">
      <div className="design-field-grid">{field('backgroundColor', 'Fill color', undefined, true)}</div>
      <DesignBackgroundImage element={element} disabled={disabled} onCommit={value => onStyle({ backgroundImage: value })} />
      <div className="design-field-grid">
        {element.computed.backgroundImage && element.computed.backgroundImage !== 'none' ? <>
          {field('backgroundSize', 'Image size')}
          {field('backgroundPosition', 'Image position')}
          {field('backgroundRepeat', 'Image repeat')}
        </> : null}
        {element.tag === 'img' ? field('objectFit', 'Image fit') : null}
      </div>
    </Section>
    <Section title="Borders">
      {sides.map(side => <details className="design-inspector-border" key={side}>
        <summary>{side}</summary>
        <div className="design-field-grid">
          {field(`border${side}Width`, side + ' border width')}
          {field(`border${side}Style`, side + ' border style')}
          {field(`border${side}Color`, side + ' border color', undefined, true)}
        </div>
      </details>)}
    </Section>
    <Section title="Typography">
      <div className="design-field-grid">
        {field('fontFamily', 'Font family', undefined, true)}
        {field('fontSize', 'Font size')}
        {field('fontWeight', 'Weight')}
        {field('color', 'Text color', undefined, true)}
        {field('lineHeight', 'Line height')}
        {field('textAlign', 'Text alignment')}
      </div>
    </Section>
    <Section title="Export">
      <button type="button" className="design-button" onClick={onExport} disabled={disabled}>Download layer HTML</button>
    </Section>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="design-properties"><h3>{title}</h3>{children}</section>;
}

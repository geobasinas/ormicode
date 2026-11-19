import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { COLOR_CHOICES, hexFromComputedColor, STYLE_CHOICES, type EditableProperty } from './design-style.ts';

type Field = readonly [EditableProperty, string];

const groups: { name: string; fields: Field[] }[] = [
  { name: 'Appearance', fields: [['backgroundColor', 'Fill'], ['opacity', 'Opacity'], ['borderRadius', 'Radius']] },
  { name: 'Border', fields: [['borderColor', 'Color'], ['borderStyle', 'Style'], ['borderWidth', 'Width']] },
  { name: 'Typography', fields: [['color', 'Text color'], ['fontSize', 'Size'], ['fontWeight', 'Weight'], ['lineHeight', 'Line height'], ['textAlign', 'Alignment']] },
  { name: 'Layout', fields: [['width', 'Width'], ['height', 'Height'], ['display', 'Display'], ['flexDirection', 'Direction'], ['alignItems', 'Align items'], ['justifyContent', 'Justify']] },
  { name: 'Spacing', fields: [['padding', 'Padding'], ['margin', 'Margin'], ['gap', 'Gap']] },
];

export function DesignElementStyles({ element, disabled, onStyle }: {
  element: ElementSelection;
  disabled: boolean;
  onStyle(property: EditableProperty, value: string): void;
}) {
  const display = element.computed.display || element.styles.display || '';
  const flex = display.includes('flex');
  const canAlign = flex || display.includes('grid');
  return <>
    <datalist id="design-style-colors">{COLOR_CHOICES.map(value => <option key={value} value={value} />)}</datalist>
    {groups.map(({ name, fields }) => {
      const visible = fields.filter(([property]) => {
        if (property === 'flexDirection') return flex;
        if (property === 'alignItems' || property === 'justifyContent' || property === 'gap') return canAlign;
        return true;
      });
      return <section key={name} className="design-properties">
        <h3>{name}</h3>
        <div className="design-field-grid">
          {visible.map(([property, label]) => <StyleField key={element.id + ':' + property} property={property} label={label}
            inline={element.styles[property] ?? ''} computed={element.computed[property] ?? ''} disabled={disabled}
            onCommit={value => { if (value !== (element.styles[property] ?? '')) onStyle(property, value); }} />)}
        </div>
      </section>;
    })}
  </>;
}

function StyleField({ property, label, inline, computed, disabled, onCommit }: {
  property: EditableProperty;
  label: string;
  inline: string;
  computed: string;
  disabled: boolean;
  onCommit(value: string): void;
}) {
  const id = 'design-style-' + property;
  const choices = (STYLE_CHOICES as Partial<Record<EditableProperty, readonly string[]>>)[property];
  const color = property === 'color' || property === 'backgroundColor' || property === 'borderColor';
  const hex = color ? hexFromComputedColor(computed) : undefined;
  const displayValue = color ? hexFromComputedColor(inline) ?? inline : inline;
  return <div className="design-property">
    <div className="design-property-heading">
      <label htmlFor={id}>{label}</label>
      {inline ? <button className="design-property-reset" type="button" aria-label={'Reset ' + property}
        title="Remove inline override" disabled={disabled} onClick={() => onCommit('')}><RotateCcw size={11} /></button> : null}
    </div>
    {choices ? <select className="design-input ormi-select" id={id} aria-label={'Selected element ' + property}
      disabled={disabled} value={inline} onChange={event => onCommit(event.currentTarget.value)}>
      <option value="">{computed || 'Auto'}</option>
      {inline && !choices.includes(inline) ? <option value={inline}>{inline}</option> : null}
      {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select> : <div className="design-style-input">
      {color ? <ColorSwatch label={label} value={hex} disabled={disabled} onCommit={onCommit} /> : null}
      <input className="design-input" id={id} aria-label={'Selected element ' + property} disabled={disabled}
        maxLength={120} defaultValue={displayValue} placeholder={hex ?? (computed || 'Auto')} title={displayValue || computed || 'Auto'}
        list={color ? 'design-style-colors' : undefined}
        onKeyDown={event => {
          if (event.key === 'Escape') event.currentTarget.value = displayValue;
          if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={event => {
          const value = event.currentTarget.value;
          event.currentTarget.value = displayValue;
          if (value !== displayValue) onCommit(value.trim().replace(/\s+/g, ' '));
        }} />
    </div>}
  </div>;
}

function ColorSwatch({ label, value, disabled, onCommit }: {
  label: string;
  value?: string;
  disabled: boolean;
  onCommit(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('#000000');
  const initialColor = value && value.length >= 7 ? value.slice(0, 7) : '#000000';
  return <Popover open={open} onOpenChange={next => { if (next) setDraft(initialColor); setOpen(next); }}>
    <PopoverTrigger asChild>
      <button type="button" className="design-swatch" aria-label={'Pick ' + label.toLowerCase()} disabled={disabled}>
        <span style={{ backgroundColor: value }} />
      </button>
    </PopoverTrigger>
    <PopoverContent className="design-property-popup" align="start" side="left" aria-label={label + ' picker'}>
      <input type="color" aria-label={label} value={draft} onChange={event => setDraft(event.currentTarget.value)} />
      <button type="button" className="design-button" disabled={disabled} onClick={() => { setOpen(false); onCommit(draft); }}>Apply color</button>
    </PopoverContent>
  </Popover>;
}

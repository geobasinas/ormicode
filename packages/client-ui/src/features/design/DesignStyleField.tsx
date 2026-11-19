import { useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { boundDesignToken, DESIGN_STYLE_VALUE_LIMIT, styleRule, type DesignToken, type EditableProperty } from '@ormicode/protocol';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { DesignTokenControl } from './DesignTokenControl.tsx';
import { hexFromComputedColor } from './design-style.ts';

export type StyleFieldProps = {
  property: EditableProperty;
  label: string;
  inline: string;
  computed: string;
  disabled: boolean;
  tokens: readonly DesignToken[];
  canCreateToken: boolean;
  onCommit(value: string): void;
  onCreateToken(token: DesignToken): void;
  onUpdateToken(token: DesignToken): void;
  className?: string;
};

export function DesignStyleField({ property, label, inline, computed, disabled, tokens, canCreateToken, onCommit, onCreateToken, onUpdateToken, className }: StyleFieldProps) {
  const id = useId();
  const rule = styleRule(property);
  const color = rule.token === 'color';
  const hex = color ? hexFromComputedColor(computed) : undefined;
  const displayValue = color ? hexFromComputedColor(inline) ?? inline : inline;
  const bound = boundDesignToken(inline);
  const fallback = hex || computed || 'Auto';
  const selectChoices = rule.pattern ? undefined : rule.choices;
  return <div className={'design-property' + (className ? ' ' + className : '')}>
    <div className="design-property-heading">
      <label htmlFor={id}>{label}</label>
      <span className="design-inspector-field-tools">
        {rule.token ? <DesignTokenControl label={label} kind={rule.token} inline={inline} computed={computed}
          tokens={tokens} disabled={disabled} canCreate={canCreateToken} onCommit={onCommit} onCreate={onCreateToken} onUpdate={onUpdateToken} /> : null}
        {inline || computed ? <button className="design-property-reset" type="button" aria-label={'Reset ' + label}
          title="Remove inline override" disabled={disabled || !inline} onClick={() => onCommit('')}><RotateCcw size={11} /></button> : null}
      </span>
    </div>
    {selectChoices ? <select className="design-input ormi-select" id={id} disabled={disabled} value={inline} onChange={event => onCommit(event.currentTarget.value)}>
      <option value="">{fallback}</option>
      {inline && !selectChoices.includes(inline) ? <option value={inline}>{bound ?? inline}</option> : null}
      {selectChoices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select> : <div className="design-style-input">
      {color && <ColorSwatch label={label} value={hex} disabled={disabled} onCommit={onCommit} />}
      {bound ? <output id={id} className="design-input design-inspector-bound" title={bound + ' · ' + fallback}>{bound}</output> :
        <InspectorValueInput id={id} value={displayValue} placeholder={fallback} disabled={disabled} onCommit={onCommit} />}
    </div>}
  </div>;
}

function InspectorValueInput({ id, value, placeholder, disabled, onCommit }: {
  id: string; value: string; placeholder: string; disabled: boolean; onCommit(value: string): void;
}) {
  return <input className="design-input" key={value} id={id} disabled={disabled}
    maxLength={DESIGN_STYLE_VALUE_LIMIT} defaultValue={value} placeholder={placeholder} title={value || placeholder}
    onKeyDown={event => {
      if (event.key === 'Escape') event.currentTarget.value = value;
      if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
    }}
    onBlur={event => {
      const next = event.currentTarget.value.trim().replace(/\s+/g, ' ');
      event.currentTarget.value = value;
      if (next !== value) onCommit(next);
    }} />;
}

function ColorSwatch({ label, value, disabled, onCommit }: { label: string; value?: string; disabled: boolean; onCommit(value: string): void }) {
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

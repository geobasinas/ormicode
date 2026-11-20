import { useState } from 'react';
import { Braces } from 'lucide-react';
import {
  boundDesignToken, DESIGN_TOKEN_LIMIT, designTokenBinding, designTokenSchema, validateDesignTokenValue,
  type DesignToken, type DesignTokenKind,
} from '@ormicode/protocol';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';

type Props = {
  kind: DesignTokenKind;
  label: string;
  inline: string;
  computed: string;
  tokens: readonly DesignToken[];
  disabled: boolean;
  canCreate: boolean;
  onCommit(value: string): void;
  onCreate(token: DesignToken): void;
  onUpdate(token: DesignToken): void;
};

export function DesignTokenControl({ kind, label, inline, computed, tokens, disabled, canCreate, onCommit, onCreate, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ name: string; value: string; existing: boolean }>();
  const bound = boundDesignToken(inline);
  const options = tokens.filter(token => token.kind === kind);
  const boundToken = options.find(token => token.name === bound);
  const literal = [boundToken?.value, inline, computed].find(value => value && validateDesignTokenValue(kind, value)) ?? '';
  const token = draft ? designTokenSchema.safeParse({ name: draft.name.trim(), value: draft.value.trim(), kind }) : undefined;
  const duplicate = draft && !draft.existing && tokens.some(item => item.name === draft.name.trim());
  return <Popover open={open} onOpenChange={next => { setOpen(next); setDraft(undefined); }}>
    <PopoverTrigger asChild>
      <button type="button" className="design-property-reset design-inspector-token-trigger" aria-label={label + ' token'}
        title={bound ? 'Bound to ' + bound : 'Bind a token'} aria-pressed={Boolean(bound)} disabled={disabled}><Braces size={12} /></button>
    </PopoverTrigger>
    <PopoverContent className="design-property-popup design-inspector-token-popup" side="left" align="start" aria-label={label + ' tokens'}>
      {draft ? <form onSubmit={event => {
        event.preventDefault();
        if (!token?.success || duplicate || disabled) return;
        if (draft.existing) onUpdate(token.data);
        else onCreate(token.data);
        setOpen(false);
      }}>
        <label>Name<input className="design-input" placeholder="color-primary" autoFocus={!draft.existing}
          disabled={draft.existing || disabled} maxLength={40} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Value<input className="design-input" autoFocus={draft.existing} disabled={disabled} maxLength={120}
          value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label>
        {duplicate ? <small>That name is already in use.</small> : null}
        <div className="design-inspector-actions">
          <button type="button" className="design-button" onClick={() => setDraft(undefined)}>Back</button>
          <button type="submit" className="design-button" disabled={disabled || !token?.success || Boolean(duplicate)}>
            {draft.existing ? 'Save token' : 'Create and bind'}
          </button>
        </div>
      </form> : <>
        <div className="design-inspector-token-list">
          {options.map(item => <button type="button" className="design-button" key={item.name} disabled={disabled} aria-pressed={item.name === bound}
            onClick={() => { onCommit(designTokenBinding(item.name)); setOpen(false); }}>
            <span>{item.name}</span><small>{item.value}</small>
          </button>)}
        </div>
        {bound ? <button type="button" className="design-button" disabled={disabled} onClick={() => { onCommit(literal); setOpen(false); }}>Detach token</button> : null}
        {boundToken ? <button type="button" className="design-button" disabled={disabled} onClick={() => setDraft({ ...boundToken, existing: true })}>Edit bound token</button> : null}
        <button type="button" className="design-button" disabled={disabled || !canCreate || tokens.length >= DESIGN_TOKEN_LIMIT || !literal}
          title={canCreate ? undefined : 'Select a layer with a valid path'}
          onClick={() => setDraft({ name: '', value: literal, existing: false })}>New token from current value</button>
      </>}
    </PopoverContent>
  </Popover>;
}

import { useRef } from 'react';
import { DESIGN_IMAGE_TYPES } from './design-image.ts';

export function DesignImageLayer({ alt, disabled, onReplace, onAlt }: {
  alt: string; disabled: boolean; onReplace(file: File): void; onAlt(value: string): void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return <section className="design-properties">
    <h3>Image</h3>
    <input ref={fileInput} hidden type="file" accept={DESIGN_IMAGE_TYPES} aria-label="Replacement image file" disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) onReplace(file);
    }} />
    <button type="button" className="design-button" disabled={disabled} onClick={() => fileInput.current?.click()}>Replace image</button>
    <label className="design-property"><span>Alt text</span>
      <input className="design-input" key={alt} defaultValue={alt} disabled={disabled} maxLength={500} onKeyDown={event => {
        if (event.key === 'Escape') event.currentTarget.value = alt;
        if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
      }} onBlur={event => {
        if (event.currentTarget.value !== alt) onAlt(event.currentTarget.value);
      }} />
    </label>
  </section>;
}

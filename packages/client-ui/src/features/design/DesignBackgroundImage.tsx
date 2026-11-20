import { useRef, useState } from 'react';
import { DESIGN_IMAGE_VALUE_LIMIT, validateStyleEdit } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';

export function DesignBackgroundImage({ element, disabled, onCommit }: {
  element: ElementSelection; disabled: boolean; onCommit(value: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const inline = element.styles.backgroundImage ?? '';
  const computed = element.computed.backgroundImage ?? '';
  const present = Boolean(computed && computed !== 'none');
  const readImage = (file: File) => {
    setError('');
    // Encoding adds a third to the raw bytes. Leave room for the MIME header below the declaration limit.
    if (file.size > 6000 || !/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
      setError('Choose a PNG, JPEG, GIF, WebP, or AVIF file up to 6 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('The image could not be read.');
    reader.onload = () => {
      const value = 'url("' + reader.result + '")';
      if (value.length <= DESIGN_IMAGE_VALUE_LIMIT && validateStyleEdit('backgroundImage', value)) onCommit(value);
      else setError('The image could not be embedded.');
    };
    reader.readAsDataURL(file);
  };
  return <>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" aria-label="Background image file"
      disabled={disabled} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) readImage(file);
      }} />
    <div className="design-inspector-actions">
      <button className="design-button" type="button" disabled={disabled} onClick={() => input.current?.click()}>{present ? 'Replace image' : 'Add image'}</button>
      {present ? <button className="design-button" type="button" disabled={disabled} onClick={() => onCommit('none')}>Remove image</button> : null}
      {inline ? <button className="design-button" type="button" disabled={disabled} onClick={() => onCommit('')}>Reset image</button> : null}
    </div>
    {error ? <small role="status">{error}</small> : null}
  </>;
}

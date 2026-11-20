import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { DesignFrame } from '@ormicode/protocol';
import { DesignPathEditor } from './DesignPathEditor.tsx';
import { standaloneSvg } from './sanitize.ts';
import { parseEditablePath, pathData, type Path } from './vector-geometry.ts';
import { cleanRichText, MAX_RICH_MARKUP, richMarkup } from './vector-rich-text.ts';
import { MAX_SVG_SOURCE, svgViewBox } from './vector-svg.ts';

export type ArtworkEdit = { kind: 'svg' | 'path' | 'rich'; frame?: DesignFrame; source: string; path?: Path };
type EditProps = { edit: ArtworkEdit; onClose(): void; onSave(html: string): Promise<boolean> };
const formatting = [
  ['Bold', 'bold'], ['Italic', 'italic'], ['Underline', 'underline'], ['Strike', 'strikeThrough'],
  ['Bullets', 'insertUnorderedList'], ['Numbers', 'insertOrderedList'],
] as const;

function RichInput({ initial, input }: { initial: string; input: React.RefObject<HTMLDivElement | null> }) {
  const accepted = useRef(initial);
  useEffect(() => { if (input.current) input.current.innerHTML = initial; }, [initial, input]);
  return <>
    <div className="design-vector-format" role="group" aria-label="Text formatting">
      {formatting.map(([label, command]) => <button type="button" key={command} className="design-vector-button"
        onMouseDown={event => event.preventDefault()} onClick={() => {
          input.current?.focus();
          document.execCommand(command);
        }}>{label}</button>)}
    </div>
    <div ref={input} className="design-vector-rich-input" role="textbox" aria-label="Rich text" aria-multiline tabIndex={0}
      contentEditable suppressContentEditableWarning onDrop={event => event.preventDefault()}
      onBeforeInput={event => {
        if (event.nativeEvent instanceof InputEvent && ['insertFromDrop', 'insertFromPaste', 'insertFromPasteAsQuotation'].includes(event.nativeEvent.inputType)) event.preventDefault();
      }}
      onPaste={event => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain').slice(0, MAX_RICH_MARKUP);
        if (text) document.execCommand('insertText', false, text);
      }} onInput={event => {
        const area = event.currentTarget;
        if (area.innerHTML.length <= MAX_RICH_MARKUP) accepted.current = area.innerHTML;
        else area.innerHTML = cleanRichText(accepted.current) ?? '';
      }} />
  </>;
}

export function DesignArtworkEditor({ edit, onClose, onSave }: EditProps) {
  const [source, setSource] = useState(edit.source);
  const [path, setPath] = useState(edit.path);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLDivElement>(null);
  const root = edit.kind === 'path' ? standaloneSvg(edit.source) : null;
  const title = edit.kind === 'rich' ? edit.frame ? 'Edit rich text' : 'Add rich text' : edit.kind === 'path' ? 'Edit Bézier path' : edit.frame ? 'Edit SVG' : 'Insert SVG';
  const save = async () => {
    let html: string;
    if (edit.kind === 'rich') {
      const clean = cleanRichText(input.current?.innerHTML ?? '');
      if (clean === null) { setError('Rich text is too large or too deeply nested.'); return; }
      html = richMarkup(clean);
    } else {
      const svg = edit.kind === 'path' ? root : standaloneSvg(source);
      if (!svg?.querySelector('path[d], rect, ellipse, circle, line, polyline[points], polygon[points]')) {
        setError('Enter one SVG with supported geometry.'); return;
      }
      if (path) {
        const d = pathData(path);
        if (d.length > 8192) { setError('This path is too large.'); return; }
        svg.firstElementChild?.setAttribute('d', d);
      }
      if (!edit.frame) {
        const box = svgViewBox(svg);
        svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
        svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
      }
      html = svg.outerHTML;
    }
    setSaving(true);
    setError('');
    if (await onSave(html)) onClose();
    else { setSaving(false); setError('Could not save to the current revision. Check the board status and retry.'); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="design-vector-scrim" />
      <Dialog.Content className="design-vector-dialog">
        <Dialog.Title className="design-vector-title">{title}</Dialog.Title>
        <Dialog.Description className="design-vector-description">{edit.kind === 'rich' ? 'Select text to format. Paste inserts plain text.' : edit.kind === 'path'
          ? 'Adjust the path within its current SVG viewport.'
          : 'Safe geometry only: paths, basic shapes, groups, and literal paints. Links, styles, scripts, and external resources are removed.'}</Dialog.Description>
        {edit.kind === 'rich' ? <RichInput initial={edit.source} input={input} /> : root && path
          ? <DesignPathEditor path={path} viewBox={svgViewBox(root)} onChange={setPath} />
          : <textarea aria-label="SVG markup" spellCheck={false} className="design-vector-source"
            maxLength={MAX_SVG_SOURCE} value={source} onChange={event => setSource(event.target.value)} />}
        {error && <p className="design-vector-error" role="alert">{error}</p>}
        <div className="design-vector-format">
          <button type="button" className="design-vector-button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="design-vector-button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : edit.frame ? 'Save' : 'Insert'}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function inspectArtwork(html: string) {
  const svg = standaloneSvg(html);
  const child = svg?.firstElementChild;
  const d = child?.getAttribute('d');
  const path = svg?.children.length === 1 && child?.localName === 'path' && d &&
    !child.hasAttribute('transform') && !svg.hasAttribute('transform') ? parseEditablePath(d) : null;
  return { svg: svg?.outerHTML, path };
}

import type { DesignFrame } from '@ormicode/protocol';
import type { useDesignPages } from './useDesignPages.ts';
import './design-pages.css';

type Props = { pages: ReturnType<typeof useDesignPages>; selected?: DesignFrame; disabled: boolean; onSelect(id: string): void; onStart(frame: DesignFrame): void };
export function DesignPagePicker({ pages, selected, disabled, onSelect, onStart }: Props) {
  const { active, act } = pages;
  const index = pages.pages.indexOf(active);
  return <section className="design-pages" aria-label="Pages">
    <div className="design-section-heading"><span>Pages</span></div>
    <select className="design-input" aria-label="Active page" value={active.id} disabled={disabled} onChange={event => onSelect(event.target.value)}>
      {pages.pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
    </select>
    <details><summary>Page settings</summary><fieldset disabled={disabled}>
      <input className="design-input" key={active.id + active.name} aria-label="Page name" defaultValue={active.name} maxLength={120} onBlur={event => { const name = event.target.value.trim(); if (name && name !== active.name) act({ type: 'page.rename', pageId: active.id, name }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <button type="button" className="design-button" onClick={() => act({ type: 'page.add', name: `Page ${pages.pages.length + 1}` })} disabled={pages.pages.length >= 24}>Add page</button>
      <button type="button" className="design-button" disabled={index === 0} onClick={() => act({ type: 'page.move', pageId: active.id, index: index - 1 })}>Move up</button>
      <button type="button" className="design-button" disabled={index === pages.pages.length - 1} onClick={() => act({ type: 'page.move', pageId: active.id, index: index + 1 })}>Move down</button>
      <button type="button" className="design-button" disabled={pages.pages.length >= 24} onClick={() => act({ type: 'page.duplicate', pageId: active.id })}>Duplicate page</button>
      <button type="button" className="design-button" disabled={pages.pages.length === 1} onClick={() => act({ type: 'page.remove', pageId: active.id })}>Delete page</button>
      <label>Background <input type="color" value={active.background ?? '#ffffff'} onChange={event => act({ type: 'page.background', pageId: active.id, background: event.target.value })} /></label>
      <button type="button" className="design-button" onClick={() => act({ type: 'page.background', pageId: active.id, background: null })}>Reset background</button>
      <button type="button" className="design-button" disabled={!selected} onClick={() => selected && act({ type: 'page.start', pageId: active.id, frameId: selected.id })}>Set selected frame as start</button>
      <button type="button" className="design-button" disabled={!active.startFrameId} onClick={() => act({ type: 'page.start', pageId: active.id, frameId: null })}>Clear start</button>
      <button type="button" className="design-button" disabled={!pages.start} onClick={() => pages.start && onStart(pages.start)}>Go to start frame</button>
    </fieldset></details>
  </section>;
}

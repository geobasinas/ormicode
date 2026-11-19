import { Code2, Copy, History, MessageSquare, MousePointer2, PanelsTopLeft, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import type { DesignDocument, DesignFrame, DesignHistorySummary, DesignOperation, DesignStylePatch, DesignToken, EditableProperty } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { DesignElementStyles } from './DesignElementStyles.tsx';
import type { LayerAlignment, LayerAxis } from './design-inspector-model.ts';
import type { ReactNode } from 'react';

const tabs = [
  { id: 'inspect', label: 'Design', icon: SlidersHorizontal },
  { id: 'html', label: 'Source', icon: Code2 },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
] as const;

export type InspectorTab = typeof tabs[number]['id'];

type Props = {
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
  document: DesignDocument | null;
  activeFrame?: DesignFrame;
  selectedElement: ElementSelection | null;
  onElementText(text: string): void;
  onSaveText(): void;
  onStyle(patch: DesignStylePatch): void;
  onAlign(axis: LayerAxis, alignment: LayerAlignment): void;
  onCreateToken(property: EditableProperty, token: DesignToken): void;
  onExportLayer(): void;
  sourceHtml: string;
  sourceStyles: string;
  sourceDirty: boolean;
  sourceConflict?: boolean;
  onSource(field: 'html' | 'styles', value: string): void;
  onSaveSource(): void;
  onDiscardSource(): void;
  history: DesignHistorySummary[];
  onRestore(revision: number): void;
  onChat(text: string): void;
  onMutate(operations: DesignOperation[]): void;
  saving: boolean;
  approval?: ReactNode;
  review?: ReactNode;
  versions?: ReactNode;
};

const geometry = [
  { key: 'x', label: 'X', min: -100000, max: 100000 },
  { key: 'y', label: 'Y', min: -100000, max: 100000 },
  { key: 'width', label: 'W', min: 80, max: 4096 },
  { key: 'height', label: 'H', min: 80, max: 4096 },
] as const;

export function DesignInspector(props: Props) {
  const { activeFrame: frame, selectedElement: element, document, tab, saving, sourceDirty } = props;
  const locked = saving || sourceDirty;
  const frameLocked = locked || Boolean(frame?.locked);
  const working = document?.workingFrameId === frame?.id;
  return <aside className="design-inspector design-pane" aria-label="Design inspector">
    <nav className="design-pane-toolbar design-inspector-nav" aria-label="Inspector sections">
      {tabs.map(({ id, label, icon: Icon }) => <button className="design-icon-button" type="button" key={id}
        aria-label={label} title={label} aria-pressed={tab === id} onClick={() => props.onTab(id)}><Icon size={15} />{tab === id ? <span>{label}</span> : null}</button>)}
    </nav>
    <div className="design-inspector-scroll">
      {tab === 'inspect' && frame ? <>
        <header className="design-selection">
          <span className="design-selection-icon">{element ? <MousePointer2 size={17} /> : <PanelsTopLeft size={17} />}</span>
          <div><strong>{element ? element.text.trim().slice(0, 46) || element.tag : frame.name}</strong><small>{element ? '<' + element.tag + '> · ' + frame.name : (frame.width < 600 ? 'Mobile frame' : 'Frame')}</small></div>
        </header>
        {element ? <>
          {element.leaf ? <section className="design-properties">
            <h3>Content</h3>
            <textarea aria-label="Selected element text" className="design-input" rows={3} value={element.text} disabled={frameLocked} onChange={event => props.onElementText(event.target.value.slice(0, 500))} />
            <button className="design-button" type="button" disabled={frameLocked} onClick={props.onSaveText}>Apply text</button>
          </section> : null}
          <DesignElementStyles key={frame.id + element.id} element={element} disabled={frameLocked} tokens={document?.tokens ?? []}
            onStyle={props.onStyle} onAlign={props.onAlign} onCreateToken={props.onCreateToken}
            onUpdateToken={token => props.onMutate([{ type: 'token.set', token }])} onExport={props.onExportLayer} />
        </> : <>
          <section className="design-properties">
            <h3>Frame</h3>
            <label className="design-property"><span>Name</span>
              <input className="design-input" key={frame.id + frame.name} aria-label="Frame name" defaultValue={frame.name} maxLength={100} disabled={frameLocked}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={event => {
                  const name = event.target.value.trim();
                  event.target.value = name || frame.name;
                  if (name && name !== frame.name) props.onMutate([{ type: 'frame.update', frameId: frame.id, patch: { name } }]);
                }} />
            </label>
            <div className="design-field-grid geometry">
              {geometry.map(({ key, label, min, max }) => <label className="design-geometry" key={frame.id + key + frame[key]}>
                <span>{label}</span>
                <input aria-label={'Frame ' + key} type="number" min={min} max={max} defaultValue={frame[key]} disabled={frameLocked}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  onBlur={event => {
                    const value = event.target.valueAsNumber;
                    if (!Number.isFinite(value)) { event.target.value = String(frame[key]); return; }
                    const next = Math.round(Math.max(min, Math.min(max, value)));
                    event.target.value = String(next);
                    if (next !== frame[key]) props.onMutate([{ type: 'frame.update', frameId: frame.id, patch: { [key]: next } }]);
                  }} />
              </label>)}
            </div>
          </section>
          <section className="design-properties">
            <h3>Direction</h3>
            <button className="design-button" type="button" disabled={locked} aria-pressed={working}
              onClick={() => props.onMutate([{ type: 'direction.select', frameId: working ? null : frame.id }])}><Star size={14} />{working ? 'Working direction' : 'Set as working direction'}</button>
          </section>
          {props.approval}
          <p className="design-inspector-hint">Select an element on the canvas or in Layers to edit its properties.</p>
        </>}
      </> : null}
      {tab === 'inspect' && !frame ? <p className="design-inspector-hint">Select a frame to inspect its properties.</p> : null}
      {tab === 'html' && (frame || sourceDirty) ? <section className="design-properties design-source">
        <label className="design-property"><span>HTML</span><textarea className="design-input" aria-label="Frame HTML source" spellCheck={false} rows={12} disabled={saving} value={props.sourceHtml} onChange={event => props.onSource('html', event.target.value)} /></label>
        <label className="design-property"><span>CSS</span><textarea className="design-input" aria-label="Frame CSS source" spellCheck={false} rows={8} disabled={saving} value={props.sourceStyles} onChange={event => props.onSource('styles', event.target.value)} /></label>
        <div className="design-inline"><button className="design-button primary" type="button" disabled={!sourceDirty || props.sourceConflict || saving} onClick={props.onSaveSource}>Save source</button><button className="design-button" type="button" disabled={!sourceDirty || saving} onClick={props.onDiscardSource}>Discard</button></div>
      </section> : null}
      {tab === 'html' && !frame && !sourceDirty ? <p className="design-inspector-hint">Select a frame to edit its source.</p> : null}
      {tab === 'feedback' ? props.review : null}
      {tab === 'history' ? props.versions : null}
      {tab === 'history' && document ? <section className="design-properties">
        <h3>Version history</h3>
        {[...props.history].reverse().map(item => <article key={item.revision} className="design-note">
          <div>r{item.revision} · {item.summary}</div><small>{new Date(item.at).toLocaleString()}</small>
          <button className="design-button" type="button" disabled={locked || item.revision === document.revision} onClick={() => props.onRestore(item.revision)}>Restore</button>
        </article>)}
      </section> : null}
      {(tab === 'feedback' || tab === 'history') && !document ? <p className="design-inspector-hint">Open a board to use {tab}.</p> : null}
    </div>
    {frame ? <footer className="design-pane-footer">
      {element ? <button type="button" className="design-button" onClick={() => props.onChat('Design context for “' + document?.name + '”, frame “' + frame.name + '”, element <' + element.tag + '>' + (element.text ? ' “' + element.text.slice(0, 100) + '”' : '') + '. ')}><MessageSquare size={14} /> Discuss element</button> :
        <><button type="button" className="design-button" disabled={frameLocked} onClick={() => props.onMutate([{ type: 'frame.duplicate', frameId: frame.id }])}><Copy size={14} /> Duplicate</button>
          <button type="button" className="design-icon-button destructive" disabled={frameLocked} title="Delete frame" aria-label="Delete frame" onClick={() => props.onMutate([{ type: 'frame.remove', frameId: frame.id }])}><Trash2 size={15} /></button></>}
    </footer> : null}
  </aside>;
}

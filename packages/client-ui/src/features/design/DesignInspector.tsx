import { Code2, Copy, History, MessageSquare, MousePointer2, PanelsTopLeft, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import type { DesignDocument, DesignFrame, DesignHistorySummary, DesignOperation } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { DesignElementStyles } from './DesignElementStyles.tsx';

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
  onStyle(property: string, value: string): void;
  sourceHtml: string;
  sourceStyles: string;
  sourceDirty: boolean;
  onSource(field: 'html' | 'styles', value: string): void;
  onSaveSource(): void;
  onDiscardSource(): void;
  history: DesignHistorySummary[];
  onRestore(revision: number): void;
  feedback: string;
  onFeedback(text: string): void;
  onAddComment(): void;
  onChat(text: string): void;
  onMutate(operations: DesignOperation[]): void;
  saving: boolean;
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
            <textarea aria-label="Selected element text" className="design-input" rows={3} value={element.text} onChange={event => props.onElementText(event.target.value.slice(0, 500))} />
            <button className="design-button" type="button" disabled={locked} onClick={props.onSaveText}>Apply text</button>
          </section> : null}
          <DesignElementStyles element={element} disabled={locked} onStyle={props.onStyle} />
        </> : <>
          <section className="design-properties">
            <h3>Frame</h3>
            <label className="design-property"><span>Name</span>
              <input className="design-input" key={frame.id + frame.name} aria-label="Frame name" defaultValue={frame.name} maxLength={100} disabled={sourceDirty}
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
                <input aria-label={'Frame ' + key} type="number" min={min} max={max} defaultValue={frame[key]} disabled={sourceDirty}
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
          <p className="design-inspector-hint">Select an element on the canvas or in Layers to edit its properties.</p>
        </>}
      </> : null}
      {tab === 'inspect' && !frame ? <p className="design-inspector-hint">Select a frame to inspect its properties.</p> : null}
      {tab === 'html' && frame ? <section className="design-properties design-source">
        <label className="design-property"><span>HTML</span><textarea className="design-input" aria-label="Frame HTML source" spellCheck={false} rows={12} disabled={saving} value={props.sourceHtml} onChange={event => props.onSource('html', event.target.value)} /></label>
        <label className="design-property"><span>CSS</span><textarea className="design-input" aria-label="Frame CSS source" spellCheck={false} rows={8} disabled={saving} value={props.sourceStyles} onChange={event => props.onSource('styles', event.target.value)} /></label>
        <div className="design-inline"><button className="design-button primary" type="button" disabled={!sourceDirty || saving} onClick={props.onSaveSource}>Save source</button><button className="design-button" type="button" disabled={!sourceDirty || saving} onClick={props.onDiscardSource}>Discard</button></div>
      </section> : null}
      {tab === 'html' && !frame ? <p className="design-inspector-hint">Select a frame to edit its source.</p> : null}
      {tab === 'feedback' && document ? <section className="design-properties">
        <h3>{frame ? 'Feedback on ' + frame.name : 'Board feedback'}</h3>
        <textarea className="design-input" aria-label="Frame feedback" rows={4} placeholder="Describe a change…" value={props.feedback} onChange={event => props.onFeedback(event.target.value)} />
        <button className="design-button" type="button" disabled={!props.feedback.trim() || locked} onClick={props.onAddComment}>Save feedback</button>
        {document.comments.map(comment => {
          const target = comment.frameId ? document.frames.find(item => item.id === comment.frameId)?.name ?? 'Deleted frame' : 'Board feedback';
          return <article key={comment.id} className="design-note">
            <div>{comment.text}</div>
            <small>{target}{comment.resolved ? ' · Resolved' : ''}</small>
            <div className="design-inline">
              <button className="design-button" type="button" onClick={() => props.onChat('Design feedback for “' + document.name + '”, ' + target + (comment.element ? ', element ' + comment.element : '') + ': ' + comment.text)}>Add to chat</button>
              <button className="design-button" type="button" disabled={locked} onClick={() => props.onMutate([{ type: 'comment.resolve', commentId: comment.id, resolved: !comment.resolved }])}>{comment.resolved ? 'Reopen' : 'Resolve'}</button>
              <button className="design-icon-button" type="button" disabled={locked} aria-label="Remove feedback" onClick={() => props.onMutate([{ type: 'comment.remove', commentId: comment.id }])}><Trash2 size={13} /></button>
            </div>
          </article>;
        })}
      </section> : null}
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
        <><button type="button" className="design-button" disabled={locked} onClick={() => props.onMutate([{ type: 'frame.duplicate', frameId: frame.id }])}><Copy size={14} /> Duplicate</button>
          <button type="button" className="design-icon-button destructive" disabled={locked} title="Delete frame" aria-label="Delete frame" onClick={() => props.onMutate([{ type: 'frame.remove', frameId: frame.id }])}><Trash2 size={15} /></button></>}
    </footer> : null}
  </aside>;
}

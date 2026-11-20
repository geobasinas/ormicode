import type { DesignFrame, DesignPage } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { pageOfFrame } from './design-pages.ts';

export function DesignPrototypeInspector({ element, frame, frames, pages, disabled, onLink, onStart }: {
  element: ElementSelection | null; frame?: DesignFrame; frames: DesignFrame[]; pages: DesignPage[]; disabled: boolean;
  onLink(id: string, action: string): void; onStart(frameId: string): void;
}) {
  const action = element?.prototypeAction ?? '';
  const targets = frames.filter(item => !item.hidden);
  const missing = action.includes(':') && !targets.some(item => item.id === action.split(':')[1]);
  const page = frame && pages.find(item => item.id === pageOfFrame(frame));
  const targetName = (target: DesignFrame) => pageOfFrame(target) === page?.id
    ? target.name : `${pages.find(item => item.id === pageOfFrame(target))?.name ?? 'Page'} / ${target.name}`;

  return <>
    <section className="design-properties">
      <h3>Interactions</h3>
      {element ? <label className="design-prototype-field">
        <span>On click · {element.text.trim().slice(0, 32) || `<${element.tag}>`}</span>
        <select className="design-input" aria-label="Click action" value={action} disabled={disabled || frame?.locked}
          onChange={event => onLink(element.id, event.target.value)}>
          <option value="">None</option>
          {missing && <option value={action} disabled>Unavailable target</option>}
          <option value="back">Go back</option>
          <option value="close-overlay">Close overlay</option>
          <optgroup label="Go to frame">
            {targets.map(target => <option value={`frame:${target.id}`} key={target.id}>{targetName(target)}</option>)}
          </optgroup>
          <optgroup label="Open overlay">
            {targets.map(target => <option value={`overlay:${target.id}`} key={target.id}>{targetName(target)}</option>)}
          </optgroup>
        </select>
      </label> : <p className="design-inspector-hint">Select an element on the canvas to set its click action.</p>}
    </section>
    {frame && !frame.hidden && <section className="design-properties">
      <h3>Flow start</h3>
      {page?.startFrameId === frame.id ? <small>This page starts at {frame.name}.</small>
        : <button className="design-button" type="button" disabled={disabled} onClick={() => onStart(frame.id)}>Set as page start</button>}
    </section>}
  </>;
}

import { useRef, type RefObject } from 'react';
import type { DesignFrame, DesignStylePatch } from '@ormicode/protocol';
import type { ElementSelection } from './DesignFramePreview.tsx';
import { embedDesignImage } from './design-image.ts';
import { validateStyleEdit } from './design-style.ts';

type Bridge = (type: string, body?: Record<string, unknown>) => void;
export function useDesignElementCommands(frame: DesignFrame | undefined, selection: ElementSelection | null, enabled: boolean,
  scope: string, bridge: RefObject<Bridge>, onError: (error: string) => void) {
  const current = useRef({ frame, selection, enabled, scope });
  current.current = { frame, selection, enabled, scope };
  const send = (type: string, body: Record<string, unknown> = {}) => {
    const { enabled, selection } = current.current;
    if (enabled) bridge.current(type, { ...body, ...(selection ? { id: selection.id } : {}) });
  };
  const image = async (file: File, replace: boolean) => {
    const target = current.current;
    if (!target.enabled || (replace && target.selection?.tag !== 'img')) return;
    const sameTarget = () => {
      const live = current.current;
      return live.enabled && live.scope === target.scope && live.frame?.id === target.frame?.id &&
        live.frame?.html === target.frame?.html && live.frame?.styles === target.frame?.styles && live.selection?.id === target.selection?.id;
    };
    try {
      const source = await embedDesignImage(file);
      if (sameTarget()) send(replace ? 'replaceImage' : 'addElement', replace ? { source } : { kind: 'image', source });
      else onError('The image target changed. Select the layer and choose the image again.');
    } catch (error) { if (sameTarget()) onError(error instanceof Error ? error.message : String(error)); }
  };
  return {
    add: (kind: string) => send('addElement', { kind }),
    addImage: (file: File) => void image(file, false),
    replaceImage: (file: File) => void image(file, true),
    imageAlt: (alt: string) => send('imageAlt', { alt }),
    manage: (action: 'duplicate' | 'remove') => send('manageLayer', { action }),
    text: () => { if (current.current.selection?.leaf) send('editText', { text: current.current.selection.text }); },
    style: (patch: DesignStylePatch) => {
      if (!current.current.enabled || !current.current.selection) return;
      const invalid = Object.entries(patch).find(([property, value]) => !validateStyleEdit(property, value)
        || (value && !CSS.supports(property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value)));
      if (invalid) onError(`Invalid value for ${invalid[0]}.`);
      else { onError(''); send('editStyles', { patch }); }
    },
  };
}

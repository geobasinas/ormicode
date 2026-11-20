import { useLayoutEffect, useRef } from 'react';
import { isDesignPrototypeAction, type DesignFrame, type DesignPrototypeAction } from '@ormicode/protocol';
import { BRIDGE_SRC_DOC } from './bridge.ts';
import { themedStyles } from './DesignFramePreview.tsx';
import { sanitizeMarkup } from './sanitize.ts';

export function DesignPrototypeScreen({ frame, scale, tokenStyles, active, hints, onAction, onEscape }: {
  frame: DesignFrame; scale: number; tokenStyles: string; active: boolean; hints: boolean;
  onAction(action: DesignPrototypeAction): void; onEscape(): void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const channel = useRef('');
  const stamp = useRef(0);
  const handlers = useRef({ active, onAction, onEscape });
  handlers.current = { active, onAction, onEscape };

  const send = (type: string, body: Record<string, unknown>) => {
    if (channel.current) iframe.current?.contentWindow?.postMessage({ channel: channel.current, type, ...body }, '*');
  };
  const render = (type: 'init' | 'render', body: Record<string, unknown>) => {
    if (!channel.current) return;
    send(type, { html: sanitizeMarkup(frame.html), styles: themedStyles(frame.styles), stamp: ++stamp.current, ...body });
  };
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!handlers.current.active || !channel.current || event.origin !== 'null' || event.source !== iframe.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.channel !== channel.current || data.stamp !== stamp.current) return;
      if (data.type === 'prototypeAction' && isDesignPrototypeAction(data.action)) handlers.current.onAction(data.action);
      if (data.type === 'prototypeEscape') handlers.current.onEscape();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useLayoutEffect(() => {
    render('render', { tokenStyles });
    // Refresh the loaded document only when the rendered source changes.
  }, [frame.html, frame.styles, tokenStyles]);
  useLayoutEffect(() => {
    send('configurePlayback', { enabled: active, hints });
  }, [active, hints]);

  return <div className="design-prototype-screen" inert={!active} style={{ width: frame.width * scale, height: frame.height * scale }}>
    <iframe ref={iframe} title={`${frame.name} prototype screen`} sandbox="allow-scripts" srcDoc={BRIDGE_SRC_DOC}
      style={{ width: frame.width, height: frame.height, transform: `scale(${scale})` }} onLoad={() => {
        channel.current = globalThis.crypto.randomUUID();
        render('init', { tokenStyles, playback: true, enabled: active, hints });
      }} />
  </div>;
}

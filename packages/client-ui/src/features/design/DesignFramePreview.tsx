import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { DesignFrame } from '@ormicode/protocol';
import { BRIDGE_SRC_DOC } from './bridge.ts';
import { sanitizeMarkup } from './sanitize.ts';
import { validateBridgeMessage } from './design-model.ts';

export interface ElementSelection {
  id: string; path: string; tag: string; leaf: boolean; text: string; styles: Record<string, string>;
}

const TOKENS = ['--bg-main', '--bg-window', '--bg-card', '--bg-raised', '--bg-inset', '--bg-selected', '--text-title', '--text-active', '--text-label', '--text-secondary', '--accent-mint', '--accent-amber', '--accent-red', '--line-divider', '--line-card'];
function themedStyles(styles: string): string {
  const values = TOKENS.flatMap(name => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{3,8}$/i.test(value) ? [`${name}:${value}`] : [];
  });
  return `:root{${values.join(';')}}\n${styles}`;
}

export function DesignFramePreview({ frame, active, onSelect, onMarkup, onReset, bridge, selectionRequest }: {
  frame: DesignFrame; active: boolean; onSelect(message: ElementSelection): void;
  onMarkup(html: string): void;
  onReset(): void;
  selectionRequest?: { path: string };
  bridge: MutableRefObject<(type: string, body?: Record<string, unknown>) => void>;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const channel = useRef('');
  const rendered = useRef({ html: '', styles: '' });
  const callbacks = useRef({ onSelect, onMarkup, onReset });
  callbacks.current = { onSelect, onMarkup, onReset };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!iframe.current?.contentWindow || event.source !== iframe.current.contentWindow || event.origin !== 'null' || !channel.current) return;
      if (!validateBridgeMessage(event.data, channel.current)) return;
      if (event.data.type === 'selected') callbacks.current.onSelect({
        id: String(event.data.id), path: String(event.data.path), tag: String(event.data.tag), leaf: Boolean(event.data.leaf), text: String(event.data.text),
        styles: event.data.styles as Record<string, string>,
      });
      if (event.data.type === 'serialized') {
        const html = sanitizeMarkup(String(event.data.html));
        rendered.current.html = html;
        callbacks.current.onMarkup(html);
      }
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); channel.current = ''; };
  }, [frame.id]);

  const send = useCallback((type: string, body: Record<string, unknown> = {}) => {
    if (!channel.current) return;
    iframe.current?.contentWindow?.postMessage({ type, channel: channel.current, ...body }, '*');
  }, []);
  useEffect(() => {
    if (!active) return;
    bridge.current = send;
    return () => {
      send('clearSelection');
      if (bridge.current === send) bridge.current = () => undefined;
    };
  }, [bridge, send, frame.id, active]);
  const onLoad = () => {
    const token = globalThis.crypto.randomUUID();
    channel.current = token;
    rendered.current = { html: sanitizeMarkup(frame.html), styles: frame.styles };
    iframe.current?.contentWindow?.postMessage({ type: 'init', channel: token, html: rendered.current.html, styles: themedStyles(frame.styles) }, '*');
    if (selectionRequest) send('selectPath', { path: selectionRequest.path });
  };
  useEffect(() => {
    if (!channel.current) return;
    const html = sanitizeMarkup(frame.html);
    if (rendered.current.html === html && rendered.current.styles === frame.styles) return;
    rendered.current = { html, styles: frame.styles };
    callbacks.current.onReset();
    send('render', { html, styles: themedStyles(frame.styles) });
  }, [frame.html, frame.styles]);
  useEffect(() => {
    if (selectionRequest) send('selectPath', { path: selectionRequest.path });
  }, [selectionRequest, send]);

  return <iframe ref={iframe} title={`${frame.name} design preview`} srcDoc={BRIDGE_SRC_DOC} sandbox="allow-scripts" onLoad={onLoad}
    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }} />;
}

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { DesignFrame, DesignPrototypeAction } from '@ormicode/protocol';
import { BRIDGE_SRC_DOC } from './bridge.ts';
import { sanitizeMarkup } from './sanitize.ts';
import { validateBridgeMessage } from './design-model.ts';
import type { ElementGeometry } from './design-inspector-model.ts';

export interface ElementSelection {
  id: string; path: string; tag: string; leaf: boolean; text: string;
  styles: Record<string, string>;
  computed: Record<string, string>;
  geometry?: ElementGeometry;
  alt?: string;
  prototypeAction?: DesignPrototypeAction;
}

export type PreviewSource = Pick<DesignFrame, 'html' | 'styles'>;
type RenderedSource = PreviewSource & { sourceHtml: string; tokenStyles: string; stamp: number };
const TOKENS = ['--bg-main', '--bg-window', '--bg-card', '--bg-raised', '--bg-inset', '--bg-selected', '--text-title', '--text-active', '--text-label', '--text-secondary', '--accent-mint', '--accent-amber', '--accent-red', '--line-divider', '--line-card'];
export function themedStyles(styles: string): string {
  const values = TOKENS.flatMap(name => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{3,8}$/i.test(value) ? [`${name}:${value}`] : [];
  });
  return `:root{${values.join(';')}}\n${styles}`;
}

export function DesignFramePreview({ frame, active, editable, interactive, zoom, onSelect, onMarkup, onReset, bridge, selectionRequest, tokenStyles = '', onLayerExport }: {
  frame: DesignFrame; active: boolean; onSelect(message: ElementSelection): void;
  editable: boolean;
  interactive: boolean;
  zoom: number;
  onMarkup(html: string, base: PreviewSource): void;
  onReset(): void;
  selectionRequest?: { path: string };
  tokenStyles?: string;
  onLayerExport?(html: string): void;
  bridge: MutableRefObject<(type: string, body?: Record<string, unknown>) => void>;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const channel = useRef('');
  const rendered = useRef<RenderedSource>({ html: '', sourceHtml: '', styles: '', tokenStyles: '', stamp: 0 });
  const callbacks = useRef({ onSelect, onMarkup, onReset, onLayerExport });
  callbacks.current = { onSelect, onMarkup, onReset, onLayerExport };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!iframe.current?.contentWindow || event.source !== iframe.current.contentWindow || event.origin !== 'null' || !channel.current) return;
      if (!validateBridgeMessage(event.data, channel.current)) return;
      if (event.data.type === 'selected') callbacks.current.onSelect({
        id: String(event.data.id), path: String(event.data.path), tag: String(event.data.tag), leaf: Boolean(event.data.leaf), text: String(event.data.text),
        styles: event.data.styles as Record<string, string>, computed: event.data.computed as Record<string, string>,
        geometry: event.data.geometry as ElementGeometry | undefined,
        alt: event.data.alt as string | undefined,
        prototypeAction: event.data.prototypeAction as DesignPrototypeAction | undefined,
      });
      if (event.data.type === 'selectionCleared') callbacks.current.onReset();
      if (event.data.type === 'serialized' && event.data.stamp === rendered.current.stamp) {
        const html = sanitizeMarkup(String(event.data.html));
        if (html === rendered.current.html) return;
        rendered.current.html = html;
        callbacks.current.onMarkup(html, { html: rendered.current.sourceHtml, styles: rendered.current.styles });
      }
      if (event.data.type === 'layerExport') callbacks.current.onLayerExport?.(String(event.data.html));
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
  useEffect(() => {
    send('configureEditor', { editable: active && editable, interactive, zoom });
  }, [send, active, editable, interactive, zoom]);
  const onLoad = () => {
    const token = globalThis.crypto.randomUUID();
    channel.current = token;
    rendered.current = { html: sanitizeMarkup(frame.html), sourceHtml: frame.html, styles: frame.styles, tokenStyles, stamp: 1 };
    iframe.current?.contentWindow?.postMessage({ type: 'init', channel: token, html: rendered.current.html, styles: themedStyles(frame.styles), tokenStyles, stamp: 1, editable: active && editable, interactive, zoom }, '*');
    if (selectionRequest) send('selectPath', { path: selectionRequest.path });
  };
  useEffect(() => {
    if (!channel.current) return;
    const html = sanitizeMarkup(frame.html);
    if (rendered.current.html === html && rendered.current.styles === frame.styles) {
      rendered.current.sourceHtml = frame.html;
      if (rendered.current.tokenStyles === tokenStyles) return;
      rendered.current.tokenStyles = tokenStyles;
      send('setTokenStyles', { tokenStyles });
      return;
    }
    const stamp = rendered.current.stamp + 1;
    rendered.current = { html, sourceHtml: frame.html, styles: frame.styles, tokenStyles, stamp };
    callbacks.current.onReset();
    send('render', { html, styles: themedStyles(frame.styles), tokenStyles, stamp });
  }, [frame.html, frame.styles, tokenStyles, send]);
  useEffect(() => {
    if (selectionRequest) send('selectPath', { path: selectionRequest.path });
  }, [selectionRequest, send]);

  return <iframe ref={iframe} title={`${frame.name} design preview`} srcDoc={BRIDGE_SRC_DOC} sandbox="allow-scripts" onLoad={onLoad}
    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }} />;
}

import { useCallback, useEffect, useState } from 'react';
import type { PromptContext } from '@ormicode/protocol';
import { feedback } from '../../lib/feedback.ts';
import { pushToComposer } from '../../lib/composer-inbox.ts';
import type { BrowserPage } from './browser-types.ts';

export type ElementInfo = {
  url: string; selector: string; html: string; text: string; styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number; devicePixelRatio?: number };
  component?: string; source?: string; index?: number; comment?: string;
};
export type PreviewFrame = {
  image: string; pixelWidth: number; pixelHeight: number; pageWidth: number; pageHeight: number; path: string;
};
export type Annotation = { id: string; index: number; kind: 'box' | 'pen' | 'pin'; points: { x: number; y: number }[]; comment: string };
type NativeImageLike = { toDataURL(): string; getSize(): { width: number; height: number } };
type PreviewWebview = {
  executeJavaScript(source: string): Promise<any>;
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<NativeImageLike>;
  getZoomFactor?(): number | Promise<number>;
};

export const annotationStorageKey = (session: string, pageId: string) => `ormi.browser.annotation.${session}.${pageId}`;

export function useBrowserInspector(session: string, viewRef: { current: PreviewWebview | null }, page?: BrowserPage, ready = false) {
  const [available, setAvailable] = useState<boolean | undefined>();
  const [hint, setHint] = useState('');
  const [pickActive, setPickActive] = useState(false);
  const [frame, setFrame] = useState<PreviewFrame>();

  useEffect(() => {
    setAvailable(undefined); setHint(''); setFrame(undefined);
    if (!ready || !page) return;
    let alive = true;
    void viewRef.current?.executeJavaScript('Boolean(window.__ormiPreview && window.__ormiPreview.pick)')
      .then(value => { if (alive) setAvailable(Boolean(value)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, [page?.id, ready, viewRef]);

  const ensureInspector = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return false;
    try {
      const found = await view.executeJavaScript('Boolean(window.__ormiPreview && window.__ormiPreview.pick)');
      setAvailable(Boolean(found));
      if (!found) setHint('Inspector unavailable — this page may not use the preview proxy or its CSP blocked the script.');
      else setHint('');
      return Boolean(found);
    } catch {
      setAvailable(false);
      setHint('Inspector unavailable — this page may not use the preview proxy or its CSP blocked the script.');
      return false;
    }
  }, [viewRef]);

  const pick = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !page) return;
    if (pickActive) {
      try { await view.executeJavaScript('window.__ormiPreview && window.__ormiPreview.cancel()'); } catch { /* Guest may have navigated. */ }
      setPickActive(false); return;
    }
    if (!await ensureInspector()) return;
    setPickActive(true);
    try {
      const selected = await view.executeJavaScript('window.__ormiPreview.pick({multi:true})') as ElementInfo[];
      if (!Array.isArray(selected) || !selected.length) return;
      const contexts: PromptContext[] = [];
      const images = [];
      for (const [index, element] of selected.entries()) {
        const dpr = element.rect?.devicePixelRatio ?? 1;
        const zoom = await Promise.resolve(view.getZoomFactor?.() ?? 1).catch(() => 1);
        const rect = element.rect;
        const viewport = await view.executeJavaScript('({ width: innerWidth, height: innerHeight })');
        const left = Math.max(0, rect.x - 8);
        const top = Math.max(0, rect.y - 8);
        const right = Math.min(viewport.width, rect.x + rect.width + 8);
        const bottom = Math.min(viewport.height, rect.y + rect.height + 8);
        const crop = {
          x: Math.floor(left * dpr * zoom), y: Math.floor(top * dpr * zoom),
          width: Math.max(1, Math.ceil((right - left) * dpr * zoom)),
          height: Math.max(1, Math.ceil((bottom - top) * dpr * zoom)),
        };
        const image = await view.capturePage(crop);
        const url = image.toDataURL();
        const data = url.split(',')[1] ?? '';
        images.push({ data, url, mimeType: 'image/png', name: `Element #${index + 1}`, size: Math.floor(data.length * 0.75) });
        contexts.push({ kind: 'element', element: { ...element, index: index + 1 } });
      }
      pushToComposer(session, { context: contexts, images });
      feedback.success(`Added ${selected.length} element${selected.length === 1 ? '' : 's'}`);
    } catch {
      setHint('Inspector unavailable — this page may not use the preview proxy or its CSP blocked the script.');
      setAvailable(false);
    } finally { setPickActive(false); }
  }, [ensureInspector, page, pickActive, session, viewRef]);

  const annotate = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !page || !await ensureInspector()) return;
    try {
      const [image, metrics] = await Promise.all([
        view.capturePage(),
        view.executeJavaScript('({ width: innerWidth, height: innerHeight })'),
      ]);
      const size = image.getSize();
      setFrame({ image: image.toDataURL(), pixelWidth: size.width, pixelHeight: size.height,
        pageWidth: metrics.width, pageHeight: metrics.height, path: page.path });
    } catch {
      setHint('Could not capture this preview frame.');
    }
  }, [ensureInspector, page, viewRef]);

  const inspectAt = useCallback(async (x: number, y: number): Promise<ElementInfo | null> => {
    const view = viewRef.current;
    if (!view || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    try { return await view.executeJavaScript(`window.__ormiPreview ? window.__ormiPreview.inspectAt(${x},${y}) : null`) ?? null; }
    catch { return null; }
  }, [viewRef]);

  const submitAnnotations = useCallback(async (items: Annotation[], image: { data: string; url: string; size: number }, send: boolean) => {
    if (!page || !items.length) return;
    const contexts: PromptContext[] = await Promise.all(items.map(async item => {
      const point = item.kind === 'box'
        ? { x: (item.points[0]!.x + item.points[1]!.x) / 2, y: (item.points[0]!.y + item.points[1]!.y) / 2 }
        : item.points[Math.floor(item.points.length / 2)]!;
      const info = await inspectAt(point.x, point.y) ?? {
        url: page.url, selector: 'body', html: '', text: '', styles: {},
        rect: { x: point.x, y: point.y, width: 0, height: 0, devicePixelRatio: 1 },
      };
      return { kind: 'element', element: { ...info, comment: item.comment, index: item.index } };
    }));
    const text = `Please address these comments on ${page.path}:\n${items.map(item => `${item.index}. ${item.comment}`).join('\n')}`;
    pushToComposer(session, { text, context: contexts, images: [{ ...image, mimeType: 'image/png', name: 'Annotation' }], send });
    setFrame(undefined);
    feedback.success(send ? 'Sent annotations to the composer' : 'Added annotations to the composer');
  }, [inspectAt, page, session]);

  return { available, hint, pickActive, frame, pick, annotate, inspectAt, submitAnnotations, setFrame };
}

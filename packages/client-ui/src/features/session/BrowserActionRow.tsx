import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { TranscriptEvent } from './useTranscript.ts';

export function BrowserActionRow({ event, session }: { event: TranscriptEvent; session: string }) {
  const { transport } = usePlatform();
  const [src, setSrc] = useState('');
  const [large, setLarge] = useState(false);
  const body = event.body;
  const artifact = typeof body.artifact === 'string' ? body.artifact : '';
  useEffect(() => {
    if (!artifact) return;
    let alive = true;
    void transport.request('browser.artifact', { session, id: artifact }).then(r => {
      if (alive && r.type === 'res') setSrc(`data:${String((r.body as { mime: string }).mime)};base64,${String((r.body as { data: string }).data)}`);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [artifact, session, transport]);
  const action = String(body.action ?? '');
  const target = String(body.target ?? '');
  const url = String(body.url ?? '');
  let path = '/';
  try { path = new URL(url || 'http://localhost/').pathname; } catch { /* Keep the neutral fallback. */ }
  const label = action === 'open' ? `opened ${path}`
    : action === 'click' ? `clicked \`${target}\`` : action === 'type' ? `typed into \`${target}\``
      : action === 'screenshot' ? 'screenshot' : action;
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: body.ok === false ? 'var(--accent-red)' : 'var(--text-hint)', fontSize: 11, margin: '3px 0' }}>
    <Globe size={12} /> <span>Browser · {label}</span>
    {src ? <button type="button" onClick={() => setLarge(true)} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}><img alt="Browser screenshot" src={src} style={{ width: 42, height: 26, objectFit: 'cover', borderRadius: 3 }} /></button> : null}
    {body.ok === false ? <span>{String(body.error ?? 'action failed')}</span> : null}
    {large ? <div role="dialog" aria-modal="true" onClick={() => setLarge(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000b', display: 'grid', placeItems: 'center' }}><img alt="Browser screenshot" src={src} style={{ maxWidth: '90vw', maxHeight: '90vh' }} /></div> : null}
  </div>;
}

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { TranscriptEvent } from './useTranscript.ts';
import { fetchArtifact } from './fetchArtifact.ts';

export function BrowserActionRow({ event, session }: { event: TranscriptEvent; session: string }) {
  const { transport } = usePlatform();
  const [src, setSrc] = useState('');
  const [large, setLarge] = useState(false);
  const body = event.body;
  const artifact = typeof body.artifact === 'string' ? body.artifact : '';
  useEffect(() => {
    if (!artifact) return;
    let alive = true;
    void fetchArtifact(transport, session, artifact).then(image => {
      if (alive) setSrc(`data:${image.mime};base64,${image.data}`);
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
  return <div style={{ display: 'grid', gap: 3, color: body.ok === false ? 'var(--accent-red)' : 'var(--text-hint)', fontSize: 11, margin: '3px 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Globe size={12} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Browser · {label}</span>
      {body.ok === false ? <span>{String(body.error ?? 'action failed')}</span> : null}
    </div>
    {src ? <button type="button" aria-label="Open browser screenshot" onClick={() => setLarge(true)} style={{ border: 0, padding: 0, marginLeft: 18, width: 96, background: 'transparent', cursor: 'pointer' }}>
      <img alt="Browser screenshot" src={src} style={{ display: 'block', boxSizing: 'border-box', width: 96, height: 60, objectFit: 'cover', border: '1px solid var(--line-card)', borderRadius: 4 }} />
    </button> : null}
    {large ? <div role="dialog" aria-modal="true" onClick={() => setLarge(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000b', display: 'grid', placeItems: 'center' }}><img alt="Browser screenshot" src={src} style={{ maxWidth: '90vw', maxHeight: '90vh' }} /></div> : null}
  </div>;
}

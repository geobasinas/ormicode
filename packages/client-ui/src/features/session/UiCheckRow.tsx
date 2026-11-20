import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { TranscriptEvent } from './useTranscript.ts';
import { fetchArtifact } from './fetchArtifact.ts';

type UiCheckEntry = {
  level: 'error' | 'warn'; kind: string; message: string; request?: string; status?: number; frames: string[];
};

export function UiCheckRow({ event, session }: { event: TranscriptEvent; session: string }) {
  const { transport } = usePlatform();
  const [src, setSrc] = useState('');
  const [large, setLarge] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const body = event.body;
  const artifact = typeof body.artifact === 'string' ? body.artifact : '';
  const errors = Number(body.errors ?? 0);
  const warnings = Number(body.warnings ?? 0);
  const entries = Array.isArray(body.entries) ? body.entries as UiCheckEntry[] : [];

  useEffect(() => {
    if (!artifact) return;
    let alive = true;
    void fetchArtifact(transport, session, artifact).then(result => {
      if (alive) setSrc(`data:${result.mime};base64,${result.data}`);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [artifact, session, transport]);

  return <div style={{ display: 'grid', gap: 4, margin: '4px 0', color: 'var(--text-hint)', fontSize: 11 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <Globe size={12} style={{ flexShrink: 0 }} />
      <span>UI check</span>
      <span>·</span>
      {errors ? <span style={{ color: 'var(--accent-red)' }}>{errors} {errors === 1 ? 'error' : 'errors'}</span>
        : <span>no errors</span>}
      {warnings > 0 ? <span>· {warnings} {warnings === 1 ? 'warning' : 'warnings'}</span> : null}
      {body.followup ? <span>· sent to agent</span> : null}
      {entries.length ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: 0, padding: '1px 3px', color: 'var(--text-hint)', background: 'transparent', font: 'inherit', cursor: 'pointer' }}>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}details
      </button> : null}
    </div>
    {src ? <button type="button" aria-label="Open UI check screenshot" onClick={() => setLarge(true)}
      style={{ border: 0, padding: 0, marginLeft: 17, width: 96, background: 'transparent', cursor: 'pointer' }}>
      <img alt="UI check screenshot" src={src} style={{ display: 'block', boxSizing: 'border-box', width: 96, height: 60, objectFit: 'cover', border: '1px solid var(--line-card)', borderRadius: 4 }} />
    </button> : null}
    {expanded ? <div style={{ marginLeft: 17, border: '1px solid var(--line-card)', borderRadius: 5, padding: 7, background: 'var(--bg-inset)', fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.45 }}>
      {entries.map((entry, index) => <div key={`${entry.kind}-${index}`} style={{ paddingTop: index ? 6 : 0, marginTop: index ? 6 : 0, borderTop: index ? '1px solid var(--line-subtle)' : 0 }}>
        <div style={{ color: entry.level === 'error' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
          {entry.level} · {entry.kind}: {entry.message}
        </div>
        {entry.request || entry.status ? <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>
          Request: {entry.request ?? 'GET'}{entry.status ? ` · ${entry.status}` : ''}
        </div> : null}
        {entry.frames?.length ? <div style={{ marginTop: 2, color: 'var(--text-hint)', whiteSpace: 'pre-wrap' }}>{entry.frames.slice(0, 3).join('\n')}</div> : null}
      </div>)}
    </div> : null}
    {large ? <div role="dialog" aria-modal="true" aria-label="UI check screenshot" onClick={() => setLarge(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000b', display: 'grid', placeItems: 'center' }}>
      <img alt="UI check screenshot" src={src} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
    </div> : null}
  </div>;
}

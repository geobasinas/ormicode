import { useEffect, useState } from 'react';
import type { DesignFrame } from '@ormicode/protocol';
import { usePlatform } from '../../../lib/platform.ts';
import type { FrameVersion } from './review-model.ts';
import { versionPreviewSrcDoc } from './version-preview.ts';
import './review.css';

export function DesignFrameVersions({ session, slug, revision, frame, disabled, onRestore }: {
  session: string; slug: string; revision: number; frame: DesignFrame; disabled: boolean; onRestore(revision: number): void;
}) {
  const { transport } = usePlatform();
  const [versions, setVersions] = useState<FrameVersion[]>([]);
  const [selected, setSelected] = useState<FrameVersion>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stale = false;
    setVersions([]); setSelected(undefined); setError(''); setLoading(true);
    void transport.request('design.frameVersions', { session, slug, frameId: frame.id }).then(response => {
      if (stale) return;
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      setVersions((response.body as { versions: FrameVersion[] }).versions);
    }).catch(reason => { if (!stale) setError(String(reason)); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [session, slug, revision, frame.id, transport]);
  const scale = selected ? Math.min(1, 210 / selected.width, 220 / selected.height) : 1;
  return <section className="design-properties review-versions"><h3>{frame.name} · Frame versions</h3>
    {loading ? <small>Loading versions…</small> : null}{error ? <small role="alert">{error}</small> : null}
    {!loading && !error && !versions.length ? <small>No retained versions.</small> : null}
    <div className="review-version-list">{versions.map(version => <button type="button" key={version.revision} className="review-version" aria-pressed={selected?.revision === version.revision} onClick={() => setSelected(version)}>
      <strong>r{version.revision}{version.current ? ' · Current' : ''}</strong><span>{version.summary}</span><small>{version.width} × {version.height}{version.at ? ` · ${new Date(version.at).toLocaleString()}` : ''}</small>
    </button>)}</div>
    {selected ? <><div className="review-version-preview" style={{ height: selected.height * scale }}>
      <iframe title={`Frame version r${selected.revision} preview`} sandbox="" srcDoc={versionPreviewSrcDoc(selected.html, selected.styles)} style={{ width: selected.width, height: selected.height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div><button type="button" className="design-button" disabled={disabled || selected.current} onClick={() => onRestore(selected.revision)}>Restore this version</button></> : null}
  </section>;
}

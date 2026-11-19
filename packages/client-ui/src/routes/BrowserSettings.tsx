import { useEffect, useState } from 'react';
import { usePlatform } from '../lib/platform.ts';

export function BrowserSettings({ enabled, onChange }: { enabled: boolean; onChange(value: boolean): void }) {
  const { transport } = usePlatform();
  const [available, setAvailable] = useState<boolean>();
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    void transport.request('browser.status', {}).then(r => { if (r.type === 'res') setAvailable(Boolean((r.body as { available?: boolean }).available)); });
    void transport.request('browser.setSettings', { checkpointScreenshots: enabled }).catch(() => undefined);
  }, [enabled, transport]);
  const install = async () => {
    setInstalling(true);
    try {
      const result = await transport.request('browser.install', {});
      setAvailable(result.type === 'res');
    } finally { setInstalling(false); }
  };
  const control = { font: 'inherit', fontSize: 11.5, color: 'var(--text-title)', background: 'transparent', border: '1px solid var(--line-card)', borderRadius: 7, padding: '0 10px', height: 26, cursor: 'pointer' };
  return <div style={{ marginTop: 18 }}>
    <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-label)', letterSpacing: 1, marginBottom: 7 }}>BROWSER</div>
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, overflow: 'hidden' }}>
      {available === false ? <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '7px 14px', borderTop: '1px solid var(--line-card)' }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--text-title)' }}>No browser found</div>
        <button style={control} disabled={installing} onClick={() => void install()}>{installing ? 'Installing…' : 'Install'}</button>
      </div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '7px 14px', borderTop: '1px solid var(--line-card)' }}>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: 'var(--text-title)' }}>Screenshot the preview at each turn&apos;s checkpoint</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Applies to all sessions</div></div>
        <button role="switch" aria-checked={enabled} disabled={available === false} onClick={() => onChange(!enabled)} style={{ width: 30, height: 17, border: 0, borderRadius: 999, padding: 2, background: enabled ? 'var(--bg-selected)' : 'var(--bg-raised)' }}><span style={{ display: 'block', marginLeft: enabled ? 13 : 0, width: 13, height: 13, borderRadius: 999, background: enabled ? 'var(--bg-main)' : 'var(--text-hint)' }} /></button>
      </div>
    </div>
  </div>;
}

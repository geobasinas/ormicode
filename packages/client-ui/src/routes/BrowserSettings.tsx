import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../lib/platform.ts';
import { Button } from '../components/ui/button.tsx';
import { SettingsSwitch } from './SettingsSwitch.tsx';

type BrowserStatus = { available: boolean; source: 'env' | 'installed' | 'system' | null; path?: string };
type BrowserSettingsState = { checkpointScreenshots: boolean; uiCheck: boolean };

export function BrowserSettings() {
  const { transport } = usePlatform();
  const [status, setStatus] = useState<BrowserStatus>();
  const [settings, setSettings] = useState<BrowserSettingsState>({ checkpointScreenshots: true, uiCheck: true });
  const [installing, setInstalling] = useState(false);
  const refresh = useCallback(async () => {
    const [statusResponse, settingsResponse] = await Promise.all([
      transport.request('browser.status', {}).catch(() => undefined),
      transport.request('browser.settings', {}).catch(() => undefined),
    ]);
    if (statusResponse?.type === 'res') setStatus(statusResponse.body as BrowserStatus);
    if (settingsResponse?.type === 'res') setSettings(settingsResponse.body as BrowserSettingsState);
  }, [transport]);

  useEffect(() => { void refresh(); }, [refresh]);
  const change = (key: keyof BrowserSettingsState, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    void transport.request('browser.setSettings', next).then(response => {
      if (response.type === 'res') setSettings(response.body as BrowserSettingsState);
    }).catch(() => undefined);
  };

  const install = async () => {
    setInstalling(true);
    try {
      await transport.request('browser.install', {});
      await refresh();
    } finally { setInstalling(false); }
  };
  const source = status?.source === 'env' ? 'ORMICODE_BROWSER'
    : status?.source === 'installed' ? 'Managed browser'
      : status?.source === 'system' ? 'System Chrome' : '';

  return <div style={{ marginTop: 18 }}>
    <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-label)', letterSpacing: 1, marginBottom: 7 }}>BROWSER PREVIEW</div>
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 14px', borderTop: '1px solid var(--line-card)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-title)' }}>{status?.available ? 'Browser found' : status ? 'No browser found' : 'Checking for a browser…'}</div>
          {status?.available ? <div style={{ marginTop: 2, color: 'var(--text-secondary)', fontSize: 11 }}>
            {source}{status.path ? <span style={{ marginLeft: 7, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)' }}>{status.path}</span> : null}
          </div> : null}
        </div>
        {status?.available === false ? <Button size="sm" variant="outline" disabled={installing} onClick={() => void install()}>{installing ? 'Installing…' : 'Install'}</Button> : null}
      </div>
      {installing ? <div className="ormi-browser-progress" aria-label="Installing browser" /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 14px', borderTop: '1px solid var(--line-card)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-title)' }}>Screenshot the preview at each turn&apos;s checkpoint</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Applies to all sessions</div>
        </div>
        <SettingsSwitch ariaLabel="Screenshot preview at checkpoints" on={settings.checkpointScreenshots}
          onChange={value => change('checkpointScreenshots', value)} disabled={!status?.available} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 14px', borderTop: '1px solid var(--line-card)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-title)' }}>Check the preview after UI changes</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>The agent sees errors and a screenshot before finishing</div>
        </div>
        <SettingsSwitch ariaLabel="Check the preview after UI changes" on={settings.uiCheck}
          onChange={value => change('uiCheck', value)} disabled={!status?.available} />
      </div>
    </div>
  </div>;
}

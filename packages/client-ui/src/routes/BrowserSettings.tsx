import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../lib/platform.ts';
import { Button } from '../components/ui/button.tsx';
import { Group, Row } from './SettingsRows.tsx';
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

  return <Group title="BROWSER PREVIEW">
    <Row title={status?.available ? 'Browser found' : status ? 'No browser found' : 'Checking for a browser…'}
      hint={status?.available ? `${source}${status.path ? ` · ${status.path}` : ''}` : undefined} mono={Boolean(status?.path)}>
      {status?.available === false ? <Button size="sm" variant="outline" disabled={installing} onClick={() => void install()}>{installing ? 'Installing…' : 'Install'}</Button> : null}
    </Row>
    {installing ? <div className="ormi-browser-progress" aria-label="Installing browser" /> : null}
    <Row title="Screenshot the preview at each turn's checkpoint" hint="Applies to all sessions">
      <SettingsSwitch ariaLabel="Screenshot preview at checkpoints" on={settings.checkpointScreenshots}
        onChange={value => change('checkpointScreenshots', value)} disabled={!status?.available} />
    </Row>
    <Row title="Check the preview after UI changes" hint="The agent sees errors and a screenshot before finishing">
      <SettingsSwitch ariaLabel="Check the preview after UI changes" on={settings.uiCheck}
        onChange={value => change('uiCheck', value)} disabled={!status?.available} />
    </Row>
  </Group>;
}

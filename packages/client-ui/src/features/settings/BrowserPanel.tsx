/** Settings → Browser preview: which browser the hub drives, and the two hub-wide checks it runs. */
import { useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { Button } from '../../components/Button.tsx';
import { Group, Message, Page, Row, Status, Toggle, failure, useHub } from './parts.tsx';

type BrowserStatus = { available: boolean; source: 'env' | 'installed' | 'system' | null; path?: string };
type Checks = { checkpointScreenshots: boolean; uiCheck: boolean };
const SOURCE = { env: 'From ORMICODE_BROWSER', installed: 'Managed by ormicode', system: 'System Chrome' } as const;

export function BrowserPanel({ connection }: { connection: string }) {
  const { transport } = usePlatform();
  const online = connection === 'online';
  const status = useHub<BrowserStatus>('browser.status', {}, online);
  const checks = useHub<Checks>('browser.settings', {}, online);
  const [local, setLocal] = useState<Checks>();
  const [installing, setInstalling] = useState(false);
  const current = local ?? checks.data;
  const change = async (key: keyof Checks, value: boolean) => {
    if (!current) return;
    const next = { ...current, [key]: value };
    setLocal(next);
    try {
      const r = await transport.request('browser.setSettings', next);
      if (r.type === 'res') setLocal(r.body as unknown as Checks); else { setLocal(current); feedback.error(failure(r)); }
    } catch (e) { setLocal(current); feedback.error(e instanceof Error ? e.message : String(e)); }
  };
  const install = async () => {
    setInstalling(true);
    try {
      const r = await transport.request('browser.install', {});
      if (r.type === 'res') { feedback.success('Browser installed'); await status.reload(); } else feedback.error(failure(r));
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); } finally { setInstalling(false); }
  };
  const s = status.data;
  return <Page title="Browser preview" subtitle="The browser agents use to open, click through and screenshot your app">
    <Group title="Browser">
      {!online ? <Row title="Connect to the hub to check its browser" />
        : status.error ? <Message tone="error">{status.error}</Message>
          : <Row title={s ? s.available ? 'Browser ready' : 'No browser found' : 'Checking…'}
            hint={s?.available ? `${s.source ? SOURCE[s.source] : ''}${s.path ? ` · ${s.path}` : ''}` : s ? 'Install a managed Chromium so agents can preview and check UI changes.' : undefined} mono={Boolean(s?.path)}>
            {s?.available ? <Status tone="ok">Ready</Status> : s ? <Button variant="primary" disabled={installing} onClick={() => void install()}>{installing ? 'Installing…' : 'Install browser'}</Button> : null}
          </Row>}
    </Group>
    <Group title="Checks">
      <Row title="Screenshot the preview at each checkpoint" hint="Each turn's checkpoint keeps a picture of the running app, so you can compare turns.">
        <Toggle label="Screenshot the preview at each checkpoint" checked={current?.checkpointScreenshots ?? false} disabled={!current || !s?.available} onChange={v => void change('checkpointScreenshots', v)} />
      </Row>
      <Row title="Check the UI after changes" hint="After a turn that edits UI files, the agent gets console errors and a screenshot before it finishes.">
        <Toggle label="Check the UI after changes" checked={current?.uiCheck ?? false} disabled={!current || !s?.available} onChange={v => void change('uiCheck', v)} />
      </Row>
    </Group>
  </Page>;
}

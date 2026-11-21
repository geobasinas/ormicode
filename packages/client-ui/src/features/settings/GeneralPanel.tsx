/** Settings → General: the hub this app is talking to and how this app reaches it. */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { agoText } from '../../lib/format.ts';
import { Group, Page, Row, Status, Value, useHub } from './parts.tsx';
import { Confirm } from './Confirm.tsx';
import { duration } from './format.ts';

interface DaemonStatus { version: string; proto: number; uptimeMs: number; liveWorkers: number; relay: 'connected' | 'disconnected'; lastError: string | null; pool?: { effective: number; cap: number; mode: string } }
interface Machine { id: string; name: string; kind: string; status: string; resources?: { onBattery?: boolean } }

const CONNECTION: Record<string, [string, 'ok' | 'warn' | 'error' | 'muted']> = {
  online: ['Connected', 'ok'], connecting: ['Connecting', 'muted'], offline: ['Hub unreachable', 'error'], unpaired: ['Not paired', 'warn'],
};

export function GeneralPanel({ connection }: { connection: string }) {
  const platform = usePlatform();
  const online = connection === 'online';
  const status = useHub<DaemonStatus>('daemon.status', {}, online);
  const machines = useHub<{ machines: Machine[] }>('machine.list', {}, online);
  const local = machines.data?.machines.find(m => m.kind === 'local');
  const [remote, setRemote] = useState(() => platform.desktop?.remote() ?? null);
  const [webRemote, setWebRemote] = useState<{ account: string; device: string; name: string } | null>();
  useEffect(() => { void platform.web?.remote().then(setWebRemote).catch(() => setWebRemote(null)); }, [platform]);
  const [label, tone] = CONNECTION[connection] ?? [connection, 'muted'];
  const s = status.data;
  const unpair = async () => {
    try {
      if (platform.desktop) { await platform.desktop.unpair(); setRemote(null); }
      else await platform.web?.unpair();
      feedback.success(platform.web ? 'This browser was forgotten' : 'Unpaired from the relay');
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); }
  };
  return <Page title="General" subtitle="The hub you're connected to and how this app reaches it">
    <Group title="This app">
      <Row title="Connection" hint={platform.desktop?.linkIsLocal() ? 'Local hub on this computer' : platform.web ? platform.web.relayUrl : remote ? `Through ${remote.relayUrl}` : platform.hubLabel} mono={Boolean(platform.web || remote)}>
        <Status tone={tone}>{label}</Status>
      </Row>
      {platform.web && !online && platform.web.lastOnline() ? <Row title="Last online" hint={agoText(platform.web.lastOnline()!)} /> : null}
      {remote ? <Row title={`Paired as ${remote.name}`} hint={`Account ${remote.account} · device ${remote.device}`} mono>
        <Confirm label="Unpair" title="Unpair this app?" confirm="Unpair"
          description="The relay forgets this app's device token. The local hub keeps working; reaching a remote hub needs a new pairing code." onConfirm={unpair} />
      </Row> : null}
      {webRemote ? <Row title={`This browser is ${webRemote.name}`} hint={`Account ${webRemote.account} · device ${webRemote.device}`} mono>
        <Confirm label="Forget browser" title="Forget this browser?" confirm="Forget"
          description="The device token is deleted from this browser. You'll need a new pairing code from the hub to reconnect." onConfirm={unpair} />
      </Row> : null}
      {platform.desktop?.storageBackend() === 'basic_text' ? <Row title="Device token is not encrypted"
        hint="No system keyring was found, so the token on disk is only obfuscated. Install and unlock a keyring (GNOME Keyring or KWallet), then restart the app.">
        <Status tone="warn">Weak</Status>
      </Row> : null}
    </Group>
    <Group title="Hub">
      {!online ? <Row title="Hub details are unavailable" hint="They appear once the app is connected." /> : status.error ? <Row title="Could not read hub status" hint={status.error} /> : <>
        <Row title={local?.name ?? 'This machine'} hint={s ? platform.desktop?.linkIsLocal() ? 'The hub runs on this computer' : 'The machine your hub runs on' : 'Loading…'}>
          {s ? <Status tone="ok">Up {duration(s.uptimeMs)}</Status> : null}
        </Row>
        <Row title="Relay" hint={s?.relay === 'connected' ? 'Paired phones and browsers can reach this hub' : 'Only this computer can reach the hub right now'}>
          {s ? <Status tone={s.relay === 'connected' ? 'ok' : 'muted'}>{s.relay === 'connected' ? 'Connected' : 'Not connected'}</Status> : null}
        </Row>
        <Row title="Agents running" hint={s?.pool ? `Up to ${s.pool.effective} at once right now${local?.resources?.onBattery ? ' (halved on battery)' : ''} · cap ${s.pool.cap}` : undefined}>
          {s ? <Value>{s.liveWorkers}</Value> : null}
        </Row>
        {s?.lastError ? <Row title="Last hub error" hint={s.lastError} mono><Status tone="error">Error</Status></Row> : null}
      </>}
    </Group>
  </Page>;
}

/** Settings → Paired devices: pair a new phone or browser, rename or revoke existing ones. */
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { agoText } from '../../lib/format.ts';
import { Button } from '../../components/Button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Group, Message, Page, Row, Status, failure, useHub } from './parts.tsx';
import { Confirm } from './Confirm.tsx';

interface Device { id: string; name: string; trustedAt: number }
interface Code { code: string; expiresAt: number; link: string; account?: string }

function PairRow({ poll }: { poll(): void }) {
  const { transport } = usePlatform();
  const [code, setCode] = useState<Code>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const p = setInterval(poll, 3000);
    return () => { clearInterval(t); clearInterval(p); };
  }, [code, poll]);
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const create = async () => {
    setBusy(true);
    try {
      const r = await transport.request('pair.create', {});
      if (r.type === 'res') { setCode(r.body as unknown as Code); setNow(Date.now()); } else feedback.error(failure(r));
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Row title="Pair a new device" hint="Creates a one-time code. Enter the account and code on your phone, or in a browser at app.ormi.codes."
    below={code && left > 0 ? <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--line-divider)' }}>
      <span aria-label="Pairing code" style={{ fontFamily: 'var(--font-mono)', fontSize: 20, letterSpacing: 2, color: 'var(--text-title)' }}>{code.code}</span>
      <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {code.account ? <>Account <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-label)' }}>{code.account}</span><br /></> : <>This hub has no relay set up, so only this computer can use the code.<br /></>}
        Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </span>
      <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(code.code.replace(/\s/g, '')).then(() => feedback.success('Code copied'))}><Copy size={13} />Copy</Button>
    </div> : null}>
    <Button disabled={busy} onClick={() => void create()}>{code && left > 0 ? 'New code' : busy ? 'Creating…' : 'Create code'}</Button>
  </Row>;
}

function DeviceRow({ device, self, changed }: { device: Device; self: boolean; changed(): void }) {
  const { transport } = usePlatform();
  const [name, setName] = useState<string>();
  const run = async (method: string, body: Record<string, unknown>, done: string) => {
    try {
      const r = await transport.request(method, body);
      if (r.type !== 'res') return feedback.error(failure(r));
      feedback.success(done); setName(undefined); changed();
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); }
  };
  const rename = () => { const next = name?.trim(); if (next && next !== device.name) void run('devices.rename', { device: device.id, name: next }, 'Device renamed'); else setName(undefined); };
  return <Row title={name !== undefined
      ? <Input aria-label={`Rename ${device.name}`} autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={rename}
          onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setName(undefined); }} style={{ height: 28, maxWidth: 260, fontSize: 13 }} />
      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{device.name}{self ? <Status tone="ok">This device</Status> : null}</span>}
    hint={`Paired ${agoText(device.trustedAt)}`}>
    {name === undefined ? <Button variant="ghost" onClick={() => setName(device.name)}>Rename</Button> : null}
    <Confirm label="Revoke" title={`Revoke ${device.name}?`} confirm="Revoke"
      description={`${device.name} loses access to this hub straight away and its open terminals close. It needs a new pairing code to come back.`}
      onConfirm={() => run('devices.revoke', { device: device.id, confirm: device.name }, `${device.name} revoked`)} />
  </Row>;
}

export function DevicesPanel({ connection }: { connection: string }) {
  const platform = usePlatform();
  const list = useHub<{ devices: Device[] }>('devices.list', {}, connection === 'online');
  const [selfId, setSelfId] = useState(() => platform.desktop?.remote()?.device);
  useEffect(() => { void platform.web?.remote().then(r => setSelfId(r?.device)).catch(() => undefined); }, [platform]);
  const devices = [...(list.data?.devices ?? [])].sort((a, b) => b.trustedAt - a.trustedAt);
  return <Page title="Paired devices" subtitle="Phones and browsers that can reach this hub through the relay">
    <Group title="Add">{connection === 'online' ? <PairRow poll={list.reload} /> : <Row title="Connect to the hub to pair a device" />}</Group>
    <Group title={devices.length ? `Devices · ${devices.length}` : 'Devices'}>
      {list.error ? <Message tone="error">{list.error}</Message>
        : list.loading ? <Row title="Loading devices…" />
          : devices.length ? devices.map(d => <DeviceRow key={d.id} device={d} self={d.id === selfId} changed={() => void list.reload()} />)
            : <Row title="No paired devices yet" hint="Create a code above to add your phone or a browser." />}
    </Group>
  </Page>;
}

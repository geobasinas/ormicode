import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as daemonSocket from '@ormicode/daemon';
import { newId } from '@ormicode/protocol';
import { loadRemote, connectRemote, saveRemote, joinRemote } from './remote.ts';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();

// Persistent CLI identity so device cursors survive reconnects.
function deviceId(): string {
  const file = join(daemonSocket.ormicodeDir(), 'device-id');
  try { return readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const id = newId('d');
  try { mkdirSync(daemonSocket.ormicodeDir(), { recursive: true }); writeFileSync(file, id); } catch { /* stateless */ }
  return id;
}

export type AnyLink = daemonSocket.Link | import('./remote.ts').WsLink;

export async function withDaemon<T>(fn: (link: AnyLink) => Promise<T>): Promise<T> {
  const remote = process.env.ORMICODE_REMOTE !== '0' ? loadRemote() : undefined;
  const hello = { v: 1, type: 'hello', role: 'client', proto: 1, device: remote?.device ?? deviceId() };
  const link: AnyLink | undefined = remote
    ? await connectRemote(remote).catch(e => { console.error(`relay unreachable: ${e.message}`); return undefined; })
    : await daemonSocket.connect(socketPath(), hello).catch(() => {
      console.error(`no daemon on ${socketPath()} — start one with \`ormi daemon\``);
      process.exit(2);
    });
  if (!link) process.exit(2);
  try { return await fn(link); } finally { link.close(); }
}

export async function daemonMain(): Promise<number> {
  const { startDaemon } = await import('@ormicode/daemon');
  const daemon = await startDaemon();
  console.log(`ormicode daemon listening on ${daemon.socketPath}`);
  await new Promise<void>(resolve => {
    process.on('SIGINT', resolve); process.on('SIGTERM', resolve);
  });
  await daemon.close();
  return 0;
}

export async function statusMain(): Promise<number> {
  return withDaemon(async link => {
    const res = await link.request('daemon.status', {});
    console.log(JSON.stringify(res.body));
    return 0;
  });
}

/** `ormi pair` — mint a code on the local hub for a new device. */
export async function pairMain(): Promise<number> {
  return withDaemon(async link => {
    const res = await link.request('pair.create', {});
    if (res.type === 'err') { console.error(`pair failed: ${res.code ?? 'error'} ${res.message ?? ''}`); return 1; }
    const { code, expiresAt, link: uri } = res.body as { code: string; expiresAt: number; link: string };
    console.log(`pairing code: ${code}  (expires ${new Date(expiresAt).toLocaleTimeString()})`);
    console.log(`link: ${uri}`);
    return 0;
  });
}

/** `ormi connect <relay-url> --account <a> --code <c> --name <n>` — pair this device. */
export async function connectMain(args: string[]): Promise<number> {
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const relayUrl = args[0];
  const account = flag('--account');
  const code = flag('--code');
  const name = flag('--name') ?? `${process.env.COMPUTERNAME ?? 'device'}-cli`;
  if (!relayUrl || !account || !code) {
    console.error('usage: ormi connect <relay-url> --account <account> --code <pairing code> [--name <device name>]');
    return 2;
  }
  try {
    const { device, token } = await joinRemote(relayUrl, account, code, name);
    saveRemote({ relayUrl, account, device, token, name });
    console.log(`paired as ${name} (${device}) — remote session commands now route through ${relayUrl}`);
    return 0;
  } catch (e) { console.error(`connect failed: ${e instanceof Error ? e.message : e}`); return 1; }
}

/** `ormi devices [list|rename <id> <name>|revoke <id>]` */
export async function devicesMain(args: string[]): Promise<number> {
  return withDaemon(async link => {
    const sub = args[0] ?? 'list';
    if (sub === 'list') {
      const res = await link.request('devices.list', {});
      const devices = ((res.body as { devices?: unknown[] })?.devices ?? []) as { id: string; name: string; trustedAt: number }[];
      for (const d of devices) console.log(`${d.id}  ${d.name}  (paired ${new Date(d.trustedAt).toLocaleString()})`);
      if (!devices.length) console.log('no paired devices');
      return 0;
    }
    if (sub === 'rename' && args[1] && args[2]) {
      const res = await link.request('devices.rename', { device: args[1], name: args[2] });
      console.log(res.type === 'err' ? `rename failed: ${res.code}` : `renamed ${args[1]}`);
      return res.type === 'err' ? 1 : 0;
    }
    if (sub === 'revoke' && args[1]) {
      const name = args[2];
      if (!name) { console.error('revoke needs the device name to confirm: ormi devices revoke <id> <name>'); return 2; }
      const res = await link.request('devices.revoke', { device: args[1], confirm: name });
      if (res.type === 'err') { console.error(`revoke failed: ${res.code}`); return 1; }
      const b = res.body as { relaySynced?: boolean };
      console.log(`revoked ${args[1]}${b.relaySynced ? ' (relay synced)' : ' (relay sync pending)'}`);
      return 0;
    }
    console.error('usage: ormi devices [list|rename <id> <name>|revoke <id> <name>]');
    return 2;
  });
}

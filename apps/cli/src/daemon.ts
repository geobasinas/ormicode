import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as daemonSocket from '@ormicode/daemon';
import { newId } from '@ormicode/protocol';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();

// Persistent CLI identity so device cursors survive reconnects.
function deviceId(): string {
  const file = join(daemonSocket.ormicodeDir(), 'device-id');
  try { return readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const id = newId('d');
  try { mkdirSync(daemonSocket.ormicodeDir(), { recursive: true }); writeFileSync(file, id); } catch { /* stateless */ }
  return id;
}

export async function withDaemon<T>(fn: (link: daemonSocket.Link) => Promise<T>): Promise<T> {
  const hello = { v: 1, type: 'hello', role: 'client', proto: 1, device: deviceId() };
  const link = await daemonSocket.connect(socketPath(), hello).catch(() => {
    console.error(`no daemon on ${socketPath()} — start one with \`ormi daemon\``);
    process.exit(2);
  });
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

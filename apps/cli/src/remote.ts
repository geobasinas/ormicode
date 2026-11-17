/**
 * Remote hub access: ~/.ormicode/remote.json holds the paired device token.
 * Session commands transparently run over wss://<relay>/connect instead of the
 * local socket when that file exists (unless --local or ORMICODE_REMOTE=0).
 * The wire side lives in @ormicode/relay-client so the desktop and web
 * shells share it; this file only owns the on-disk config.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ormicodeDir } from '@ormicode/daemon';
import type { RemoteEndpoint } from '@ormicode/relay-client';

export { WsLink, connectRemote, joinRemote } from '@ormicode/relay-client';

export interface RemoteConfig extends RemoteEndpoint { name: string }

export function loadRemote(): RemoteConfig | undefined {
  try {
    const c = JSON.parse(readFileSync(join(ormicodeDir(), 'remote.json'), 'utf8')) as RemoteConfig;
    return c.relayUrl && c.account && c.device && c.token ? c : undefined;
  } catch { return undefined; }
}
export function saveRemote(c: RemoteConfig): void {
  writeFileSync(join(ormicodeDir(), 'remote.json'), JSON.stringify(c, null, 2), { mode: 0o600 });
}

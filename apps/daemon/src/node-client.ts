// Node side of machine pairing: a daemon becomes a node of a hub when
// ~/.ormicode/node.json exists — { relayUrl, account, device, token, name? }.
// It connects to the hub's relay as a device, announces itself, then pushes
// machine.sessions summaries and heartbeats. Journals stay on the node; the
// hub merges the summaries into session.list/idx.
import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectRemote, type RemoteEndpoint, type WsLink } from '@ormicode/relay-client';
import { listSessions } from '@ormicode/session-store';
import { ormicodeDir } from './socket.ts';
import type { DispatchCtx } from './dispatch.ts';

export interface NodeConfig extends RemoteEndpoint { name?: string; machine?: string }

export function loadNodeConfig(): NodeConfig | undefined {
  try {
    const c = JSON.parse(readFileSync(join(ormicodeDir(), 'node.json'), 'utf8')) as NodeConfig;
    return c.relayUrl && c.account && c.device && c.token ? c : undefined;
  } catch { return undefined; }
}

const HEARTBEAT_MS = 30_000;
const RETRY_MS = 15_000;

export function startNode(ctx: DispatchCtx, config: NodeConfig): () => void {
  let link: WsLink | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const machine = config.machine ?? `m_${config.device}`;

  const later = (ms: number, fn: () => void) => { timer = setTimeout(fn, ms); timer.unref(); };
  const sessions = () => listSessions(ctx.db).filter(s => !s.deleted)
    .map(s => ({ id: s.id, title: s.title, state: s.state, updatedAt: s.updated_at, vendor: s.vendor, project: s.project }));
  const push = (method: string, body: Record<string, unknown>) =>
    link && !link.closed ? link.request(method, body, 10_000).catch(() => undefined) : Promise.resolve(undefined);

  const beat = async () => {
    if (stopped) return;
    if (!link || link.closed) return void connect();
    await push('machine.heartbeat', { machine });
    await push('machine.sessions', { machine, sessions: sessions() });
    later(HEARTBEAT_MS, () => void beat());
  };

  const connect = async () => {
    if (stopped) return;
    try {
      link = await connectRemote(config);
      await push('machine.announce', {
        machine, name: config.name ?? hostname() ?? config.device,
        resources: ctx.resources.status(),
      });
      void beat();
    } catch { later(RETRY_MS, () => void connect()); }
  };

  void connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); link?.close(); };
}

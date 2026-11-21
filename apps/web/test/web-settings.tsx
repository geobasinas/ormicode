import { createRoot } from 'react-dom/client';
import { App } from '@ormicode/client-ui';
import type { ClientPlatform } from '@ormicode/client-platform';
import '@ormicode/client-ui/index.css';

const calls: { method: string; body: Record<string, unknown> }[] = [];
(window as unknown as { calls: typeof calls }).calls = calls;
const setting = (key: string, value: number | string, min = 1, max = 64) => ({ key, value, default: value, set: false, min, max });
const settings = [setting('idleTimeout.laptop', 1_200_000, 60_000, 86_400_000), setting('pool.cap', 20), { key: 'utility.agent', value: 'default', default: 'default', set: false, choices: ['default', 'claude/cli'] },
  setting('utility.dailyCapUsd', 1, 0, 100), setting('team.children', 4, 1, 8), setting('team.concurrent', 3, 1, 8), setting('team.depth', 2, 1, 5), setting('team.maxTeams', 3, 1, 10), setting('team.silenceMs', 600_000, 60_000, 21_600_000)];
const bodies: Record<string, unknown> = {
  'agents.list': { agents: [{ vendor: 'claude', transports: ['cli', 'sdk'] }] }, 'project.list': { projects: [] }, 'session.list': { sessions: [] },
  'session.digest': { computedAt: Date.now(), entries: [] }, 'session.draft.get': { text: '' },
  'daemon.status': { version: '0.0.0', proto: 1, uptimeMs: 7_200_000, liveWorkers: 1, relay: 'connected', lastError: null, pool: { effective: 6, cap: 20, mode: 'auto' } },
  'machine.list': { machines: [{ id: 'm_local', name: 'hub-box', kind: 'local', status: 'online', heartbeat: Date.now(), resources: { cpus: 8, totalRam: 16e9, freeRam: 6e9, diskFree: 200e9, diskFloorBytes: 5e9, pool: { effective: 6, cap: 20 }, idleTimeoutMs: 1_200_000 } }] },
  'settings.get': { profile: 'laptop', settings },
  'devices.list': { devices: [{ id: 'd_web', name: 'Pixel browser', trustedAt: Date.now() - 86_400_000 }] },
  'cost.totals': { total: { tokens: 120_000, usd: 1.25, unpriced: 0, estimate: true }, projects: [], days: [] },
  'pricing.status': { version: 'v', source: 'openrouter', fetchedAt: Date.now(), models: 380 },
};
const transport: ClientPlatform['transport'] = {
  request: async (method, body = {}) => {
    calls.push({ method, body });
    if (method === 'settings.set') return { v: 1, type: 'res', id: 'r', ok: true, body: { ...settings.find(s => s.key === body.key)!, value: body.value as number, set: true } } as never;
    return { v: 1, type: 'res', id: 'r', ok: true, body: (bodies[method] ?? {}) } as never;
  },
  subscribe() {}, unsubscribe() {}, onEvent: undefined, subscribeEvents: () => () => {},
  set onState(listener: ((state: string) => void) | undefined) { listener?.('online'); }, get onState() { return undefined; },
};
const platform: ClientPlatform = {
  kind: 'web', transport, hubLabel: 'relay', tokens: { get: async () => 'tok', set: async () => {}, clear: async () => {} },
  web: { relayUrl: 'https://relay.ormi.codes', version: '0.0.0', commit: 'abc1234', remote: async () => ({ account: 'acme', device: 'd_web', name: 'Pixel browser' }),
    pair: async () => ({ device: 'd_web' }), unpair: async () => { calls.push({ method: 'unpair', body: {} }); }, lastOnline: () => Date.now() },
};
createRoot(document.getElementById('root')!).render(<App platform={platform} />);

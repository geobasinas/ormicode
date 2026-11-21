// Hub-side handling of frames pushed by paired nodes over their device link.
// A node is another daemon that joined the hub as a device and announces
// itself; it owns its journals and pushes session summaries so the hub's
// session.list/idx can show them (request forwarding is a separate step).
import { touchMachine, upsertMachine } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';
import type { RemoteLink } from './relay.ts';

export const NODE_METHODS = new Set(['machine.announce', 'machine.heartbeat', 'machine.sessions']);

interface RemoteSummary { id: string; title?: unknown; state?: unknown; updatedAt?: unknown; vendor?: unknown; project?: unknown; machine?: unknown; deleted?: unknown }

function summaries(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 2_000).flatMap(item => {
    const s = item as RemoteSummary;
    if (!s || typeof s.id !== 'string' || !s.id) return [];
    return [{
      id: s.id,
      ...(typeof s.title === 'string' ? { title: s.title } : {}),
      ...(typeof s.state === 'string' ? { state: s.state } : {}),
      ...(typeof s.updatedAt === 'number' ? { updatedAt: s.updatedAt } : {}),
      ...(typeof s.vendor === 'string' ? { vendor: s.vendor } : {}),
      ...(typeof s.project === 'string' ? { project: s.project } : {}),
    }];
  });
}

export function nodeMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): void {
  const device = (client.link as Partial<RemoteLink>).device ?? 'node';
  if (method === 'machine.announce') {
    const machine = typeof body.machine === 'string' && body.machine ? body.machine : `m_${device}`;
    const meta: Record<string, unknown> = { device };
    if (body.resources && typeof body.resources === 'object') meta.resources = body.resources;
    upsertMachine(ctx.db, { id: machine, name: typeof body.name === 'string' && body.name ? body.name : device, kind: 'node', meta });
    ctx.nodeMachines.set(device, machine);
    return client.link.reply(id, { ok: true, machine });
  }
  // Heartbeats/session pushes carry the machine id when the node knows it;
  // fall back to the device-derived id so an unannounced push still registers.
  const machine = typeof body.machine === 'string' && body.machine ? body.machine : (ctx.nodeMachines.get(device) ?? `m_${device}`);
  ctx.nodeMachines.set(device, machine);
  touchMachine(ctx.db, machine, { device });
  if (method === 'machine.heartbeat') return client.link.reply(id, { ok: true });
  ctx.remoteSessions.set(machine, { at: Date.now(), sessions: summaries(body.sessions) });
  ctx.sessionsChanged();
  client.link.reply(id, { ok: true });
}

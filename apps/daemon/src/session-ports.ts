import { createServer } from 'node:net';
import type { Store } from '@ormicode/session-store';
import { assignSessionPorts, getSessionPorts } from '@ormicode/session-store';

export const SESSION_PORT_COUNT = 10;

function portRange(value = process.env.ORMICODE_PORT_RANGE ?? '41000-48999'): [number, number] {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(value.trim());
  const start = Number(match?.[1]); const end = Number(match?.[2]);
  if (!match || start < 1 || end > 65535 || end - start + 1 < SESSION_PORT_COUNT)
    throw new Error(`invalid ORMICODE_PORT_RANGE: ${value}`);
  return [start, end];
}

function canBind(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(error => resolve(!error)));
  });
}

export async function allocateSessionPorts(
  db: Store, session: string, range = process.env.ORMICODE_PORT_RANGE ?? '41000-48999',
): Promise<{ base: number; count: 10 }> {
  const existing = getSessionPorts(db, session);
  if (existing !== undefined) return { base: existing, count: SESSION_PORT_COUNT };
  const [start, end] = portRange(range);
  const reserved = new Set((db.prepare('SELECT base FROM session_ports').all() as { base: number }[]).map(row => row.base));
  for (let base = Math.ceil(start / SESSION_PORT_COUNT) * SESSION_PORT_COUNT; base + SESSION_PORT_COUNT - 1 <= end; base += SESSION_PORT_COUNT) {
    if (reserved.has(base)) continue;
    let available = true;
    for (let port = base; port < base + SESSION_PORT_COUNT; port++) {
      if (!await canBind(port)) { available = false; break; }
    }
    if (!available) continue;
    if (assignSessionPorts(db, session, base)) return { base, count: SESSION_PORT_COUNT };
    const raced = getSessionPorts(db, session);
    if (raced !== undefined) return { base: raced, count: SESSION_PORT_COUNT };
    reserved.add(base);
  }
  throw new Error(`no free ${SESSION_PORT_COUNT}-port block in ${range}`);
}

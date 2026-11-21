// Machine registry (README "Machines"): local machine plus paired nodes.
// kind: 'local' | 'node' | 'boat'. meta holds JSON (device link id, resources).
import type { Store } from './db.ts';

export interface MachineRow { id: string; name: string; kind: string; last_seen: number; meta: string | null }
export interface MachineInfo { id: string; name: string; kind: string; lastSeen: number; meta: Record<string, unknown> | null }

const row = (m: MachineRow): MachineInfo => {
  let meta: Record<string, unknown> | null = null;
  try { meta = m.meta ? JSON.parse(m.meta) as Record<string, unknown> : null; } catch { /* bad meta */ }
  return { id: m.id, name: m.name, kind: m.kind, lastSeen: m.last_seen, meta };
};

export function upsertMachine(db: Store, machine: { id: string; name: string; kind: string; meta?: Record<string, unknown> }): void {
  db.prepare(`INSERT INTO machines(id, name, kind, last_seen, meta) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, last_seen = excluded.last_seen, meta = excluded.meta`)
    .run(machine.id, machine.name, machine.kind, Date.now(), machine.meta ? JSON.stringify(machine.meta) : null);
}

export function touchMachine(db: Store, id: string, meta?: Record<string, unknown>): void {
  if (meta) db.prepare('UPDATE machines SET last_seen = ?, meta = ? WHERE id = ?').run(Date.now(), JSON.stringify(meta), id);
  else db.prepare('UPDATE machines SET last_seen = ? WHERE id = ?').run(Date.now(), id);
}

export function listMachines(db: Store): MachineInfo[] {
  return (db.prepare('SELECT * FROM machines').all() as MachineRow[]).map(row);
}

export function removeMachine(db: Store, id: string): boolean {
  return db.prepare('DELETE FROM machines WHERE id = ?').run(id).changes > 0;
}

import type { Store } from './db.ts';

export interface DeviceRow {
  id: string; name: string; token_hash: string;
  trusted_at: number; revoked_at: number | null;
}

export function addDevice(db: Store, d: { id: string; name: string; tokenHash: string }): void {
  db.prepare('INSERT INTO devices(id, name, token_hash, trusted_at) VALUES (?, ?, ?, ?)')
    .run(d.id, d.name, d.tokenHash, Date.now());
}

export function getDeviceByHash(db: Store, tokenHash: string): DeviceRow | undefined {
  return db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
    .get(tokenHash) as DeviceRow | undefined;
}

export function listDevices(db: Store, includeRevoked = false): DeviceRow[] {
  return db.prepare(`SELECT * FROM devices ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY trusted_at`)
    .all() as DeviceRow[];
}

export function renameDevice(db: Store, id: string, name: string): boolean {
  return db.prepare('UPDATE devices SET name = ? WHERE id = ? AND revoked_at IS NULL').run(name, id).changes > 0;
}

export function revokeDevice(db: Store, id: string): boolean {
  return db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(Date.now(), id).changes > 0;
}

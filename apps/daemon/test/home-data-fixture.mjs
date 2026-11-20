import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, addDevice } from '@ormicode/session-store';

/** Reads a ustar archive into { name: Buffer }. */
export function untar(buffer) {
  const files = {};
  for (let at = 0; at + 512 <= buffer.length;) {
    const header = buffer.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('ascii').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    assert.equal(sum, parseInt(header.subarray(148, 156).toString('ascii'), 8), `checksum for ${name}`);
    files[name] = buffer.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A home with every kind of file the README lists, secrets included. */
export function seedHome(home) {
  mkdirSync(home, { recursive: true });
  const db = openStore(join(home, 'store.db'));
  addDevice(db, { id: 'd_phone', name: 'phone', tokenHash: 'HASH_OF_DEVICE_TOKEN_SHOULD_NOT_EXPORT' });
  db.close();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ machine: { id: 'm_1', name: 'box' }, relay: { url: 'wss://relay', token: 'CONFIG_TOKEN' } }));
  mkdirSync(join(home, 'logs', 'sessions', 's_1'), { recursive: true });
  writeFileSync(join(home, 'logs', 'daemon.log'), 'daemon started\n');
  writeFileSync(join(home, 'logs', 'daemon.log.1'), 'older daemon log\n');
  writeFileSync(join(home, 'logs', 'sessions', 's_1', 'stdout.log'), 'SESSION_LOG_SECRET\n');
  writeFileSync(join(home, 'logs', 'secrets-audit.jsonl'), '{}\n');
  writeFileSync(join(home, 'hub.json'), JSON.stringify({ token: 'HUB_TOKEN' }));
  writeFileSync(join(home, 'remote.json'), JSON.stringify({ token: 'REMOTE_TOKEN' }));
  writeFileSync(join(home, 'device.token'), 'DEVICE_TOKEN');
  mkdirSync(join(home, 'desktop'));
  writeFileSync(join(home, 'desktop', 'device.token'), 'DESKTOP_TOKEN');
  writeFileSync(join(home, 'desktop', 'layout.json'), '{}');
  mkdirSync(join(home, 'cache')); writeFileSync(join(home, 'cache', 'models.json'), '{}');
  mkdirSync(join(home, 'notes')); writeFileSync(join(home, 'notes', 'n.md'), 'note');
  mkdirSync(join(home, 'scratch', 's_1'), { recursive: true }); writeFileSync(join(home, 'scratch', 's_1', 'draft.txt'), 'mine');
  mkdirSync(join(home, 'skills')); writeFileSync(join(home, 'skills', 'a.md'), 'skill');
  writeFileSync(join(home, 'secrets-index.json'), '{}');
}

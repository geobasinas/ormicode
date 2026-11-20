import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from '@ormicode/session-store';
import { seedHome, untar } from './home-data-fixture.mjs';
import { writeExport, wipeHome, ConfirmationError, storeBusy } from '../src/home-data.ts';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const temp = prefix => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir; };

test('export holds the store, config and daemon logs, and no tokens or session logs', () => {
  const home = join(temp('ormi-export-'), 'home');
  seedHome(home);
  const out = join(temp('ormi-export-out-'), 'export.tar');
  const { files } = writeExport(home, out);
  assert.deepEqual(files, ['store.db', 'config.json', 'logs/daemon.log', 'logs/daemon.log.1']);
  const tar = untar(readFileSync(out));
  assert.deepEqual(Object.keys(tar).sort(), ['config.json', 'logs/daemon.log', 'logs/daemon.log.1', 'manifest.json', 'store.db']);
  const all = readFileSync(out).toString('latin1');
  for (const secret of ['HUB_TOKEN', 'REMOTE_TOKEN', 'DEVICE_TOKEN', 'DESKTOP_TOKEN', 'SESSION_LOG_SECRET', 'CONFIG_TOKEN', 'HASH_OF_DEVICE_TOKEN'])
    assert.equal(all.includes(secret), false, `${secret} leaked into the export`);
  assert.deepEqual(JSON.parse(tar['config.json']), { machine: { id: 'm_1', name: 'box' }, relay: { url: 'wss://relay' } });
  assert.equal(tar['logs/daemon.log'].toString(), 'daemon started\n');
  const copy = join(temp('ormi-export-db-'), 'store.db');
  writeFileSync(copy, tar['store.db']);
  const db = new Database(copy, { readonly: true });
  assert.deepEqual(db.prepare('SELECT id, name, token_hash FROM devices').all(), [{ id: 'd_phone', name: 'phone', token_hash: null }]);
  db.close();
  assert.deepEqual(readdirSync(home).filter(name => name.startsWith('.export')), [], 'temp snapshot removed');
  assert.throws(() => writeExport(home, out), /EEXIST/, 'never overwrites an existing file');
});

test('export does not follow a daemon log symlinked out of home', () => {
  const base = temp('ormi-export-link-');
  const home = join(base, 'home');
  seedHome(home);
  writeFileSync(join(base, 'outside.txt'), 'OUTSIDE_SECRET');
  rmSync(join(home, 'logs', 'daemon.log'));
  symlinkSync(join(base, 'outside.txt'), join(home, 'logs', 'daemon.log'));
  const out = join(base, 'export.tar');
  assert.deepEqual(writeExport(home, out).files, ['store.db', 'config.json', 'logs/daemon.log.1']);
  assert.equal(readFileSync(out).toString('latin1').includes('OUTSIDE_SECRET'), false);
});

test('wipe needs the exact confirmation word and changes nothing otherwise', () => {
  const home = join(temp('ormi-wipe-no-'), 'home');
  seedHome(home);
  const before = readdirSync(home).sort();
  for (const word of ['', 'yes', 'WIPE', ' wipe', 'wipe '])
    assert.throws(() => wipeHome(home, word), ConfirmationError);
  assert.deepEqual(readdirSync(home).sort(), before);
});

test('wipe removes store, logs, cache and keys and keeps config and your files', () => {
  const home = join(temp('ormi-wipe-'), 'home');
  seedHome(home);
  assert.equal(storeBusy(home), false);
  const { removed, leftover } = wipeHome(home, 'wipe');
  assert.equal(leftover, undefined);
  for (const gone of ['store.db', 'logs', 'cache', 'hub.json', 'remote.json', 'device.token', 'desktop/device.token', 'notes'])
    assert.ok(removed.includes(gone), `${gone} reported`);
  assert.deepEqual(readdirSync(home).sort(), ['config.json', 'desktop', 'scratch', 'secrets-index.json', 'skills']);
  assert.deepEqual(readdirSync(join(home, 'desktop')), ['layout.json']);
  assert.equal(readFileSync(join(home, 'scratch', 's_1', 'draft.txt'), 'utf8'), 'mine');
});

test('wipe deletes a symlink inside home, never what it points at', () => {
  const base = temp('ormi-wipe-link-');
  const home = join(base, 'home');
  seedHome(home);
  const outside = join(base, 'elsewhere');
  mkdirSync(outside); writeFileSync(join(outside, 'keep.txt'), 'outside');
  rmSync(join(home, 'cache'), { recursive: true });
  symlinkSync(outside, join(home, 'cache'));
  wipeHome(home, 'wipe');
  assert.equal(existsSync(join(home, 'cache')), false);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'outside');
});

test('wipe refuses before touching anything when a target folder leaves home', () => {
  const base = temp('ormi-wipe-escape-');
  const home = join(base, 'home');
  seedHome(home);
  const outside = join(base, 'other-desktop');
  mkdirSync(outside); writeFileSync(join(outside, 'device.token'), 'other');
  rmSync(join(home, 'desktop'), { recursive: true });
  symlinkSync(outside, join(home, 'desktop'));
  const before = readdirSync(home).sort();
  assert.throws(() => wipeHome(home, 'wipe'), /leaves/);
  assert.deepEqual(readdirSync(home).sort(), before);
  assert.equal(readFileSync(join(outside, 'device.token'), 'utf8'), 'other');
});

test('storeBusy sees a connection that holds the store open', () => {
  const home = join(temp('ormi-busy-'), 'home');
  seedHome(home);
  const db = openStore(join(home, 'store.db'));
  try { assert.equal(storeBusy(home), true); } finally { db.close(); }
  assert.equal(storeBusy(home), false);
});

test('a wipe that fails part way puts everything back', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const home = join(temp('ormi-wipe-rollback-'), 'home');
  seedHome(home);
  const before = readdirSync(home).sort();
  chmodSync(join(home, 'desktop'), 0o500);
  try { assert.throws(() => wipeHome(home, 'wipe'), /nothing was deleted/); }
  finally { chmodSync(join(home, 'desktop'), 0o700); }
  assert.deepEqual(readdirSync(home).sort(), before);
  assert.equal(readFileSync(join(home, 'hub.json'), 'utf8'), JSON.stringify({ token: 'HUB_TOKEN' }));
  assert.equal(storeBusy(home), false);
});

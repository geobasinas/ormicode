import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { dataMethod } from '../src/data-methods.ts';
import { RemoteLink } from '../src/relay.ts';
import { seedHome, untar } from './home-data-fixture.mjs';

const base = mkdtempSync(join(tmpdir(), 'ormi-data-methods-'));
test.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
Object.assign(process.env, { ORMICODE_KEYRING: 'memory', ORMICODE_PRICES_URL: 'off' });

let n = 0;
const boot = async ({ storeOutside = false } = {}) => {
  const home = join(base, `home${n++}`);
  seedHome(home);
  process.env.ORMICODE_HOME = home;
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: storeOutside ? join(base, `outside${n}.db`) : join(home, 'store.db') });
  const client = await connect(daemon.socketPath);
  return { home, daemon, client };
};

test('data.export streams a tar without tokens and cleans up its temp file', async () => {
  const { home, daemon, client } = await boot();
  try {
    const started = await client.request('data.export', {});
    assert.equal(started.type, 'res', JSON.stringify(started));
    assert.match(started.body.name, /^ormicode-export-\d{8}-\d{6}\.tar$/);
    assert.deepEqual(started.body.files, ['store.db', 'config.json', 'logs/daemon.log', 'logs/daemon.log.1']);
    const parts = [];
    for (let offset = 0, done = false; !done;) {
      const chunk = await client.request('data.exportChunk', { handle: started.body.handle, offset });
      assert.equal(chunk.type, 'res', JSON.stringify(chunk));
      const bytes = Buffer.from(chunk.body.data, 'base64');
      parts.push(bytes); offset += bytes.length; done = chunk.body.done;
    }
    const tar = Buffer.concat(parts);
    assert.equal(tar.length, started.body.size);
    assert.deepEqual(Object.keys(untar(tar)).sort(), ['config.json', 'logs/daemon.log', 'logs/daemon.log.1', 'manifest.json', 'store.db']);
    for (const secret of ['HUB_TOKEN', 'DEVICE_TOKEN', 'SESSION_LOG_SECRET', 'HASH_OF_DEVICE_TOKEN']) assert.equal(tar.toString('latin1').includes(secret), false, secret);
    assert.deepEqual(readdirSync(home).filter(name => name.startsWith('.export')), []);
    assert.equal((await client.request('data.exportChunk', { handle: started.body.handle, offset: 0 })).code, 'data.export_expired');
  } finally { client.close(); await daemon.close(); }
});

test('data.wipe with the wrong word leaves the hub running and the data in place', async () => {
  const { home, daemon, client } = await boot();
  try {
    for (const confirm of ['', 'yes', 'WIPE']) assert.equal((await client.request('data.wipe', { confirm })).code, 'data.confirm_mismatch');
    assert.equal((await client.request('daemon.status', {})).type, 'res');
    assert.ok(existsSync(join(home, 'store.db')) && existsSync(join(home, 'hub.json')));
  } finally { client.close(); await daemon.close(); }
});

test('data.wipe refuses when the store lives outside home', async () => {
  const { home, daemon, client } = await boot({ storeOutside: true });
  try {
    assert.equal((await client.request('data.wipe', { confirm: 'wipe' })).code, 'data.store_elsewhere');
    assert.ok(existsSync(join(home, 'hub.json')));
  } finally { client.close(); await daemon.close(); }
});

test('data.wipe stops the hub, closes the store, deletes local data and reports it', async () => {
  const { home, daemon, client } = await boot();
  const other = await connect(daemon.socketPath);
  assert.equal((await other.request('daemon.status', {})).type, 'res');
  const otherClosed = new Promise(resolve => { other.onClose = resolve; });
  const reply = await client.request('data.wipe', { confirm: 'wipe' });
  assert.equal(reply.type, 'res', JSON.stringify(reply));
  assert.equal(reply.body.wiped, true);
  assert.ok(reply.body.removed.includes('store.db') && reply.body.removed.includes('hub.json'));
  await daemon.stopped;
  await otherClosed;
  assert.deepEqual(readdirSync(home).sort(), ['config.json', 'desktop', 'scratch', 'secrets-index.json', 'skills']);
  await daemon.close();
});

test('data.* refuses paired devices that reach the hub through the relay', async () => {
  const frames = [];
  const link = new RemoteLink({ send: frame => frames.push(frame), connected: () => true }, 'd_phone');
  for (const [method, body] of [['data.export', {}], ['data.wipe', { confirm: 'wipe' }]]) {
    await dataMethod({}, { link, subscriptions: new Set(), device: 'd_phone' }, 'req_1', method, body);
    assert.equal(frames.pop().code, 'data.local_only');
  }
});

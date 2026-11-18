import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { openStore } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';

test('declared secrets gate session.start, are injected and redacted from the journal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-sec-daemon-'));
  Object.assign(process.env, { ORMICODE_KEYRING: 'memory', ORMICODE_HOME: join(dir, 'home') });
  const project = join(dir, 'proj');
  mkdirSync(join(project, '.ormi'), { recursive: true });
  writeFileSync(join(project, '.ormi', 'secrets.yaml'), 'secrets:\n  - API_TOKEN\n');
  const storePath = join(dir, 'store.db');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const client = await connect(daemon.socketPath);
  const start = () => client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  try {
    assert.equal((await start()).code, 'secrets.missing');
    assert.deepEqual((await client.request('secret.status', { project })).body, { keyring: 'memory', declared: ['API_TOKEN'], missing: ['API_TOKEN'] });
    assert.equal((await client.request('secret.set', { name: 'API_TOKEN', value: 'tok_supersecret', project })).body.ok, true);
    const session = (await start()).body.session;
    for (let i = 0; i < 200 && (await client.request('session.get', { session })).body.state !== 'idle'; i++) await new Promise(r => setTimeout(r, 50));
    await client.request('session.prompt', { session, text: 'echo tok_supersecret please' });
    const db = openStore(storePath);
    let rows = [];
    for (let i = 0; i < 200 && !rows.some(r => r.kind === 'turn_end'); i++) { await new Promise(r => setTimeout(r, 50)); rows = replay(db, session); }
    db.close();
    const all = rows.map(r => r.payload).join('\n');
    assert.ok(!all.includes('tok_supersecret'), all);
    assert.match(all, /\[redacted:API_TOKEN\]/);
    const audit = readFileSync(join(dir, 'home', 'logs', 'secrets-audit.jsonl'), 'utf8');
    assert.match(audit, /"name":"API_TOKEN","action":"inject"/);
    assert.ok(!audit.includes('tok_supersecret'));
  } finally {
    await daemon.close();
    delete process.env.ORMICODE_KEYRING; delete process.env.ORMICODE_HOME;
  }
});

test('secret.list merges the names-only index with project declarations and never stores values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-sec-list-'));
  const home = join(dir, 'home');
  Object.assign(process.env, { ORMICODE_KEYRING: 'memory', ORMICODE_HOME: home });
  const project = join(dir, 'project');
  mkdirSync(join(project, '.ormi'), { recursive: true });
  writeFileSync(join(project, '.ormi', 'secrets.yaml'), 'secrets:\n  - DECLARED_MISSING\n');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try {
    await client.request('secret.set', { name: 'MACHINE_TOKEN', value: `machine-${Date.now()}` });
    await client.request('secret.set', { name: 'PROJECT_TOKEN', value: `project-${Date.now()}`, project });
    const result = await client.request('secret.list', { project });
    assert.equal(result.body.keyring, 'memory');
    assert.equal(result.body.available, true);
    assert.deepEqual(result.body.secrets, [
      { name: 'DECLARED_MISSING', scope: 'project', declared: true, missing: true },
      { name: 'MACHINE_TOKEN', scope: 'machine', declared: false, missing: false },
      { name: 'PROJECT_TOKEN', scope: 'project', declared: false, missing: false },
    ]);
    const index = readFileSync(join(home, 'secrets-index.json'), 'utf8');
    assert.deepEqual(JSON.parse(index), { machine: ['MACHINE_TOKEN'], projects: { [project]: ['PROJECT_TOKEN'] } });
    assert.ok(!index.includes('machine-') && !index.includes('project-'));
    await client.request('secret.delete', { name: 'PROJECT_TOKEN', project });
    assert.deepEqual((await client.request('secret.list', { project })).body.secrets.map(s => s.name), ['DECLARED_MISSING', 'MACHINE_TOKEN']);
  } finally {
    client.close();
    await daemon.close();
    delete process.env.ORMICODE_KEYRING; delete process.env.ORMICODE_HOME;
  }
});

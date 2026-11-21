import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeMethod } from '../src/node-methods.ts';

// Minimal in-memory store covering the machines-table SQL the helpers run.
function fakeDb() {
  const machines = new Map();
  return {
    machines,
    prepare(sql) {
      if (sql.startsWith('INSERT INTO machines'))
        return { run: (id, name, kind, ts, meta) => machines.set(id, { id, name, kind, last_seen: ts, meta }) };
      if (sql.startsWith('UPDATE machines'))
        return { run: (...args) => { const m = machines.get(args.at(-1)); if (m) m.last_seen = args[0]; return { changes: m ? 1 : 0 }; } };
      if (sql.startsWith('SELECT * FROM machines')) return { all: () => [...machines.values()] };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

function fakeCtx(db) {
  return {
    db, changed: 0,
    nodeMachines: new Map(), remoteSessions: new Map(),
    sessionsChanged() { this.changed += 1; },
  };
}

function fakeClient() {
  const replies = [];
  return { replies, link: { device: 'd_phone', reply: (id, body) => replies.push({ id, body }) } };
}

test('machine.announce registers the node and binds device → machine', () => {
  const ctx = fakeCtx(fakeDb()); const client = fakeClient();
  nodeMethod(ctx, client, 'r1', 'machine.announce', { machine: 'm_home', name: 'home box', resources: { ram: 32 } });
  const row = ctx.db.machines.get('m_home');
  assert.equal(row.name, 'home box');
  assert.equal(row.kind, 'node');
  assert.equal(JSON.parse(row.meta).device, 'd_phone');
  assert.equal(ctx.nodeMachines.get('d_phone'), 'm_home');
  assert.deepEqual(client.replies[0].body, { ok: true, machine: 'm_home' });
});

test('machine.sessions stores sanitized summaries and refreshes idx', () => {
  const ctx = fakeCtx(fakeDb()); const client = fakeClient();
  nodeMethod(ctx, client, 'r1', 'machine.announce', { machine: 'm_home', name: 'home' });
  nodeMethod(ctx, client, 'r2', 'machine.sessions', {
    machine: 'm_home',
    sessions: [
      { id: 's1', title: 'fix', state: 'running', updatedAt: 1, vendor: 'claude', project: '/x', evil: 'dropped' },
      { title: 'no id — dropped' },
    ],
  });
  assert.equal(ctx.changed, 1);
  const remote = ctx.remoteSessions.get('m_home');
  assert.equal(remote.sessions.length, 1);
  assert.deepEqual(remote.sessions[0], { id: 's1', title: 'fix', state: 'running', updatedAt: 1, vendor: 'claude', project: '/x' });
  assert.ok(ctx.db.machines.get('m_home').last_seen > 0);
});

test('unannounced pushes still register under the device-derived id', () => {
  const ctx = fakeCtx(fakeDb()); const client = fakeClient();
  nodeMethod(ctx, client, 'r1', 'machine.heartbeat', {});
  assert.ok(ctx.db.machines.has('m_d_phone') === false, 'heartbeat only touches, does not insert');
  nodeMethod(ctx, client, 'r2', 'machine.sessions', { sessions: [{ id: 's1' }] });
  assert.equal(ctx.nodeMachines.get('d_phone'), 'm_d_phone');
  assert.ok(ctx.remoteSessions.has('m_d_phone'));
});

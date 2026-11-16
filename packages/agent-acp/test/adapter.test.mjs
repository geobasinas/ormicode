import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AcpAdapter } from '../src/index.ts';
import { validateTurn } from '@ormicode/agent-core';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = mode => (_command, args, options) => spawn(process.execPath, [fixture], { ...options, env: { ...process.env, FAKE_ACP_MODE: mode } });
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  const task = (async () => { for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; } })();
  await adapter.prompt(handle, { text });
  await task;
  return events;
}
for (const mode of ['v1', 'v2']) {
  test(`${mode}: streams a turn to turn_end and reports acpVersion`, async () => {
    const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake(mode) });
    const handle = await adapter.start({ cwd: process.cwd() });
    assert.equal(adapter.acpVersion(handle), mode === 'v1' ? 1 : 2);
    const events = await run(adapter, handle, 'hello');
    assert.equal(events.at(-1).kind, 'turn_end');
    assert.ok(events.some(e => e.kind === 'text_delta' || e.kind === 'text'));
    assert.deepEqual(validateTurn(events), []);
    await adapter.dispose(handle);
  });
  test(`${mode}: forwards the exact permission option`, async () => {
    const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake(mode) });
    const handle = await adapter.start({ cwd: process.cwd() });
    try {
      const events = []; const stream = adapter.events(handle);
      const task = (async () => {
        for await (const event of stream) {
          events.push(event);
          if (event.kind === 'approval_request') await adapter.approve(handle, event.request, 'deny');
          if (event.kind === 'turn_end' || event.kind === 'interrupted') break;
        }
      })();
      await adapter.prompt(handle, { text: 'approval-test' });
      await task;
      assert.equal(events.at(-1).kind, 'turn_end');
      assert.ok(events.some(e => e.kind === 'approval_decision' && e.option === 'deny'));
    } finally { await adapter.dispose(handle); }
  });
}
test('v1: resumes via session/load and rejects a missing mode option', async () => {
  const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake('v1') });
  const handle = await adapter.start({ cwd: process.cwd() });
  await adapter.setMode(handle, 'code');
  await adapter.dispose(handle);
  const resumed = await adapter.resume({ cwd: process.cwd(), id: 'fake-v1-1' });
  assert.equal(adapter.acpVersion(resumed), 1);
  await adapter.dispose(resumed);
});
test('v2: changes a config option through session/set_config_option', async () => {
  const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake('v2') });
  const handle = await adapter.start({ cwd: process.cwd() });
  await adapter.setMode(handle, 'code');
  assert.equal(adapter.configOptions(handle)[0].current, 'code');
  await adapter.dispose(handle);
});
test('negotiation: -32022 falls back to a fresh v1 connection', async () => {
  const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake('reject-v2') });
  const handle = await adapter.start({ cwd: process.cwd() });
  assert.equal(adapter.acpVersion(handle), 1);
  const events = await run(adapter, handle, 'hello');
  assert.equal(events.at(-1).kind, 'turn_end');
  await adapter.dispose(handle);
});
for (const mode of ['v1', 'v2']) {
  test(`${mode}: session/cancel resolves a held prompt as user_abort`, async () => {
    const adapter = new AcpAdapter({ vendor: 'fake', command: 'fake-acp', spawn: fake(mode) });
    const handle = await adapter.start({ cwd: process.cwd() });
    try {
      const events = []; const stream = adapter.events(handle);
      const task = (async () => { for await (const e of stream) { events.push(e); if (e.kind === 'interrupted' || e.kind === 'turn_end') break; } })();
      await adapter.prompt(handle, { text: 'wait' });
      await adapter.interrupt(handle);
      await task;
      assert.equal(events.at(-1).kind, 'interrupted');
      assert.equal(events.at(-1).reason, 'user_abort');
      await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
    } finally { await adapter.dispose(handle); }
  });
}

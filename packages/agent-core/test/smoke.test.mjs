import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter, smokeAdapter } from '../src/index.ts';

test('smoke harness reports a working echo adapter', async () => {
  const steps = await smokeAdapter('fake', 'cli', {
    create: () => new FakeAdapter(),
    timeoutMs: 5_000,
  });
  const byName = Object.fromEntries(steps.map(s => [s.step, s.status]));
  assert.equal(byName.detect, 'ok');
  assert.equal(byName.start, 'ok');
  assert.equal(byName.turn, 'ok');
  assert.equal(byName.tool, 'unverified'); // echo never emits tool calls
  assert.equal(byName.resume, 'unverified'); // fake does not implement resume
  assert.ok(!steps.some(s => s.status === 'fail'));
});

test('smoke harness reports kill and resume when supported', async () => {
  const steps = await smokeAdapter('fake', 'cli', {
    create: () => new FakeAdapter({ script: 'slow', delayMs: 60_000 }),
    kill: true,
    timeoutMs: 5_000,
  });
  assert.equal(steps.find(s => s.step === 'kill')?.status, 'ok');
  assert.equal(steps.find(s => s.step === 'turn')?.status, 'fail'); // slow turn gets killed
});

test('smoke harness fails closed on a bad factory', async () => {
  const steps = await smokeAdapter('fake', 'cli', {
    create: () => { throw new Error('no vendor'); },
    timeoutMs: 5_000,
  });
  assert.equal(steps[0].status, 'fail');
});

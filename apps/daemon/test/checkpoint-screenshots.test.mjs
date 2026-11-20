import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckpointScreenshotScheduler } from '../src/checkpoint-screenshots.ts';

test('turn end captures once with the latest checkpoint and merged file list', async () => {
  const resolvers = new Map();
  const captured = [];
  const startedAt = Date.now();
  const scheduler = new CheckpointScreenshotScheduler(
    (_session, seq) => new Promise(resolve => resolvers.set(seq, result => resolve(result))),
    async (...args) => { captured.push(args); return { errors: 0, path: '/', consoleIds: [] }; },
    async () => true,
  );
  scheduler.start('s_test', 7);
  scheduler.checkpoint('s_test', 10, 'edit');
  scheduler.checkpoint('s_test', 20, 'write');
  const ended = scheduler.end('s_test');
  resolvers.get(20)({ id: 'cp_newer', files: ['README.md'] });
  resolvers.get(10)({ id: 'cp_older', files: ['src/App.tsx'] });
  const result = await ended;
  assert.equal(captured.length, 1);
  assert.equal(captured[0][1], 'cp_newer');
  assert.deepEqual(captured[0][2], ['src/App.tsx', 'README.md']);
  assert.ok(captured[0][3] >= startedAt);
  assert.equal(captured[0][4], 7);
  assert.equal(result.shouldCheck, true);
  assert.deepEqual(await result.result, { errors: 0, path: '/', consoleIds: [] });
});

test('turn end does not capture when no checkpoint was produced', async () => {
  const captured = [];
  const scheduler = new CheckpointScreenshotScheduler(async () => undefined, async (_session, id) => captured.push(id), async () => false);
  scheduler.start('s_test');
  await scheduler.end('s_test');
  assert.deepEqual(captured, []);
});

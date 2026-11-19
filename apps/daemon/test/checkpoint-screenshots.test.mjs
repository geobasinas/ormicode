import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckpointScreenshotScheduler } from '../src/checkpoint-screenshots.ts';

test('turn end captures the latest checkpoint by sequence after pending snapshots finish', async () => {
  const resolvers = new Map();
  const captured = [];
  const scheduler = new CheckpointScreenshotScheduler(
    (_session, seq) => new Promise(resolve => resolvers.set(seq, resolve)),
    async (_session, checkpoint) => { captured.push(checkpoint); },
  );
  scheduler.start('s_test');
  scheduler.checkpoint('s_test', 10, 'edit');
  scheduler.checkpoint('s_test', 20, 'write');
  scheduler.end('s_test');
  resolvers.get(20)('cp_newer');
  resolvers.get(10)('cp_older');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(captured, ['cp_newer']);
});

test('turn end does not capture when no checkpoint was produced', async () => {
  const captured = [];
  const scheduler = new CheckpointScreenshotScheduler(async () => undefined, async (_session, id) => captured.push(id));
  scheduler.start('s_test');
  scheduler.end('s_test');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(captured, []);
});

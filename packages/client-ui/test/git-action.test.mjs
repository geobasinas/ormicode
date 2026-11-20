import test from 'node:test';
import assert from 'node:assert/strict';
import { gitAction } from '../src/features/git/git-action.ts';

test('Git actions retain success data and turn protocol and connection failures into panel messages', async () => {
  assert.deepEqual(await gitAction({ request: async () => ({ type: 'res', body: { sha: 'abc' } }) }, 's', 'git.commit', {}), { body: { sha: 'abc' } });
  for (const message of ['Set user.name/user.email for this repository', 'disconnected']) {
    for (const thrown of [false, true]) {
      const transport = { request: async () => { if (thrown) throw new Error(message); return { type: 'err', code: 'git.failed', message }; } };
      assert.deepEqual(await gitAction(transport, 's', 'git.commit', {}), { error: message });
    }
  }
  assert.deepEqual(await gitAction({ request: async () => ({ type: 'err', code: 'git.failed' }) }, 's', 'git.commit', {}), { error: 'git.failed' });
});

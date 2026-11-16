import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));

test('starts app-server, performs initialize and correlates requests', async () => {
  const server = await CodexAppServer.start({ spawn: (_cmd, _args, options) => spawn(process.execPath, [fixture], options) });
  assert.deepEqual(await server.request('test/echo', { value: 42 }), { value: 42 });
  server.close();
  await assert.rejects(server.request('test/echo', {}), /closed/);
});

test('rejects pending requests when the child exits', async () => {
  const server = await CodexAppServer.start({ spawn: (_cmd, _args, options) => spawn(process.execPath, [fixture], options) });
  await assert.rejects(server.request('test/crash', {}, 1000), /closed|failed/);
  server.close();
});

test('rejects an invalid initialize response', async () => {
  const fake = "process.stdin.once('data', b => { const r = JSON.parse(b.toString()); console.log(JSON.stringify({id:r.id,result:{}})); });";
  await assert.rejects(CodexAppServer.start({ spawn: (_cmd, _args, options) => spawn(process.execPath, ['-e', fake], options) }), /Invalid app-server initialize response/);
});

test('starts and resumes read-only threads and starts and interrupts turns', async () => {
  const server = await CodexAppServer.start({ spawn: (_cmd, _args, options) => spawn(process.execPath, [fixture], options) });
  try {
    assert.equal(await server.startThread({ cwd: '/repo' }), 'thread-1');
    assert.equal(await server.resumeThread({ cwd: '/repo', threadId: 'thread-1' }), 'thread-1');
    assert.equal(await server.startTurn('thread-1', 'hello'), 'turn-1');
    await server.interruptTurn('thread-1', 'turn-1');
    await assert.rejects(server.startTurn('', 'hello'), /required/);
  } finally { server.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OpenCodeServer, OPENCODE_SERVER_START_TIMEOUT_MS } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
test('private server uses authenticated SDK calls and checks session identity', async () => {
 let args; let env;
 const server = await OpenCodeServer.start({ spawn: (_cmd, received, options) => { args = received; env = options.env; return spawn(process.execPath, [fixture], options); } });
 try {
  assert.deepEqual(args, ['serve', '--hostname', '127.0.0.1', '--port', '0']);
  assert.ok(env.OPENCODE_SERVER_PASSWORD.length >= 32);
  assert.equal(await server.createSession(process.cwd()), 'ses_fake');
  assert.equal((await server.getSession('ses_fake')).id, 'ses_fake');
 } finally { server.close(); }
 await assert.rejects(server.createSession(process.cwd()), /closed/);
});
test('startup fails closed for missing or malformed server startup', async () => {
 await assert.rejects(OpenCodeServer.start({ timeoutMs: 100, spawn: (_c, _a, options) => spawn(process.execPath, ['-e', 'setTimeout(()=>{},1000)'], options) }), /timed out/);
 await assert.rejects(OpenCodeServer.start({ spawn: (_c, _a, options) => spawn(process.execPath, ['-e', 'process.exit(2)'], options) }), /exited/);
});

test('rejects an incompatible OpenCode server version', async () => {
 await assert.rejects(OpenCodeServer.start({ spawn: (_c, _a, options) => spawn(process.execPath, [fixture], { ...options, env: { ...options.env, ORMICODE_FIXTURE_VERSION: '2.3.0' } }) }), /Unsupported OpenCode server version/);
});
test('cold-start timeout is bounded and longer than the SDK default', () => {
 assert.ok(OPENCODE_SERVER_START_TIMEOUT_MS >= 30_000);
 assert.ok(OPENCODE_SERVER_START_TIMEOUT_MS <= 60_000);
});
test('current opencode serve banner is ready once health responds', async () => {
 const server = await OpenCodeServer.start({ spawn: (_c, _a, options) => spawn(process.execPath, [fixture], { ...options, env: { ...options.env, ORMICODE_FIXTURE_BANNER: 'opencode server listening', ORMICODE_FIXTURE_HEALTH: '1' } }) });
 try { assert.equal(await server.createSession(process.cwd()), 'ses_fake'); }
 finally { server.close(); }
});
test('startup still times out when the banner is up but health never answers', async () => {
 await assert.rejects(OpenCodeServer.start({ timeoutMs: 400, spawn: (_c, _a, options) => spawn(process.execPath, ['-e', 'console.log("opencode server listening on http://127.0.0.1:9"); setTimeout(()=>{},10000)'], options) }), /timed out/);
});

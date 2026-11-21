import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AcpConnection } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_command, _args, options) => spawn(process.execPath, [fixture], options);

test('ACP initializes, creates and loads sessions, streams updates and cancels unhandled permissions', async () => {
 const updates = [];
 const connection = await AcpConnection.start({ executable: 'fixture', args: [], spawn: fake, onNotification: (method, params) => updates.push({ method, params }) });
 try {
  const { sessionId } = await connection.newSession('/repo');
  await connection.loadSession(sessionId, '/repo');
  assert.equal(await connection.prompt(sessionId, 'hello'), 'end_turn');
  assert.equal(updates[0].params.update.content.text, 'hello');
 } finally { connection.close(); }
});

test('ACP rejects incompatible versions and invalid input', async () => {
 const script = `process.stdin.once('data', b => { const q = JSON.parse(b.toString()); console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:2}})); });`;
 await assert.rejects(AcpConnection.start({ executable: 'fake', args: [], spawn: (_c, _a, options) => spawn(process.execPath, ['-e', script], options) }), /version/);
 const connection = await AcpConnection.start({ executable: 'fixture', args: [], spawn: fake });
 try { await assert.rejects(connection.prompt('', 'hello'), /required/); }
 finally { connection.close(); }
});

test('does not load sessions if the agent did not advertise support', async () => {
 const script = `process.stdin.once('data', b => { const q = JSON.parse(b.toString()); console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:1,agentCapabilities:{}}})); });`;
 const connection = await AcpConnection.start({ executable: 'fake', args: [], spawn: (_c, _a, options) => spawn(process.execPath, ['-e', script], options) });
 try { await assert.rejects(connection.loadSession('s', process.cwd()), /did not advertise/); }
 finally { connection.close(); }
});

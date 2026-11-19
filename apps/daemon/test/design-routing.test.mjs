import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, setState } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { startDaemon, connect } from '../src/index.ts';

const cli = fileURLToPath(new URL('../../cli/src/ormi.ts', import.meta.url));
const mcp = fileURLToPath(new URL('../src/mcp-serve.ts', import.meta.url));
function runCli(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}
function callMcp(method, params, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcp], { env });
    let output = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP timeout: ${stderr}`)); }, 10000);
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => {
      output += data;
      const end = output.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer); child.kill(); resolve(JSON.parse(output.slice(0, end)));
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
  });
}

test('design events fan out by canonical cwd; CLI file/stdin and MCP stay session scoped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-routing-'));
  const project = join(dir, 'project'); const otherProject = join(dir, 'other');
  mkdirSync(project); mkdirSync(otherProject);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const self = newId('s'); const sibling = newId('s'); const other = newId('s');
  try {
    for (const [id, cwd] of [[self, project], [sibling, join(project, '..', 'project')], [other, otherProject]]) createSession(daemon.db, { id, machine: newId('m'), project: cwd, cwd, vendor: 'fake', transport: 'cli' });
    setState(daemon.db, self, 'running');
    for (const session of [self, sibling, other]) await client.request('session.subscribe', { session });
    const changed = [];
    client.onFrame = frame => { if (frame.type === 'evt' && frame.body.kind === 'design_changed') changed.push(frame.session); };
    assert.equal((await client.request('design.create', { session: self, slug: 'home', name: 'Home' })).type, 'res');
    assert.deepEqual(changed.sort(), [self, sibling].sort());
    assert.equal((await client.request('design.create', { session: other, slug: 'home', name: 'Other' })).type, 'res');
    const env = { ...process.env, ORMICODE_SOCKET: daemon.socketPath, ORMI_SESSION: self, ORMICODE_HOME: dir, ORMICODE_REMOTE: '0' };
    const operations = join(dir, 'operations.json');
    writeFileSync(operations, JSON.stringify([{ type: 'frame.add', name: 'Phone', x: 0, y: 0, width: 390, height: 844, html: '<p>File input</p>', styles: '' }]));
    const fromFile = await runCli(['design', 'update', self, 'home', '1', operations], undefined, env);
    assert.equal(fromFile.status, 0, fromFile.stderr);
    const frameId = JSON.parse(fromFile.stdout).document.frames[0].id;
    const fromStdin = await runCli(['design', 'update', self, 'home', '2', '-'], JSON.stringify([{ type: 'frame.update', frameId, patch: { html: '<p>Stdin input</p>' } }]), env);
    assert.equal(fromStdin.status, 0, fromStdin.stderr);
    assert.equal(JSON.parse(fromStdin.stdout).document.frames[0].html, '<p>Stdin input</p>');
    assert.equal((await runCli(['design', 'update', self, 'home', '3', '-'], '{', env)).status, 2);
    const tools = await callMcp('tools/list', {}, env);
    assert.equal(tools.result.tools.find(tool => tool.name === 'ormi_design_get').inputSchema.properties.session, undefined);
    const got = await callMcp('tools/call', { name: 'ormi_design_get', arguments: { slug: 'home', session: other } }, env);
    const document = JSON.parse(got.result.content[0].text).document;
    assert.equal(document.name, 'Home');
    assert.equal(document.frames[0].html, '<p>Stdin input</p>');
  } finally { client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true }); }
});

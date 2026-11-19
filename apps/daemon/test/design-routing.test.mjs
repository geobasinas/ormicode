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
    for (const tool of tools.result.tools.filter(tool => tool.name.startsWith('ormi_design_'))) {
      assert.equal(tool.inputSchema.properties.session, undefined);
    }
    const operationsSchema = tools.result.tools.find(tool => tool.name === 'ormi_design_update').inputSchema.properties.operations;
    const frameUpdate = operationsSchema.items.anyOf.find(item => item.properties?.type?.const === 'frame.update');
    assert.ok(frameUpdate?.required.includes('frameId'));
    assert.equal(frameUpdate.properties.patch.properties.width.minimum, 80);
    const got = await callMcp('tools/call', { name: 'ormi_design_get', arguments: { slug: 'home', session: other } }, env);
    const document = JSON.parse(got.result.content[0].text).document;
    assert.equal(document.name, 'Home');
    assert.equal(document.frames[0].html, '<p>Stdin input</p>');
    const edits = [];
    client.onFrame = frame => { if (frame.type === 'evt' && frame.body.kind === 'design_changed') edits.push(frame); };
    const updated = await callMcp('tools/call', { name: 'ormi_design_update', arguments: {
      slug: 'home', expectedRevision: 3, operations: [{ type: 'frame.update', frameId, patch: { html: '<p>Sibling MCP edit</p>' } }],
    } }, env);
    assert.equal(JSON.parse(updated.result.content[0].text).document.revision, 4);
    assert.deepEqual(edits.map(frame => frame.session).sort(), [self, sibling].sort());
    assert.deepEqual(edits.find(frame => frame.session === sibling).body, {
      kind: 'design_changed', slug: 'home', revision: 4, originSession: self, source: 'mcp', summary: 'frame.update',
    });
    assert.equal((await client.request('design.get', { session: sibling, slug: 'home' })).body.document.frames[0].html, '<p>Sibling MCP edit</p>');
    assert.equal((await client.request('design.get', { session: other, slug: 'home' })).body.document.revision, 1);
    const journal = await callMcp('tools/call', { name: 'ormi_design_activity', arguments: { slug: 'home', session: other } }, env);
    const activity = JSON.parse(journal.result.content[0].text);
    assert.deepEqual(activity.edits.map(edit => edit.revision), [4, 3, 2, 1]);
    assert.equal(activity.edits[0].source, 'mcp');
    assert.equal(activity.edits[0].originSession, self);
    assert.equal((await client.request('design.activity', { session: other, slug: 'home' })).body.edits[0].originSession, other);
    assert.deepEqual((await client.request('design.activity', { session: sibling, slug: 'home' })).body.edits, activity.edits);
    const replayFrom = edits.find(frame => frame.session === sibling).seq;
    edits.length = 0;
    await client.request('session.subscribe', { session: sibling, after: replayFrom - 1 });
    assert.deepEqual(edits.map(frame => [frame.seq, frame.body.source]), [[replayFrom, 'mcp']]);
  } finally { client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true }); }
});

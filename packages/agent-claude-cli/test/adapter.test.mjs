import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ClaudeCliAdapter } from '../src/index.ts';

const fixture = fileURLToPath(new URL('./fixtures/cli-fixture.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('.', import.meta.url));
function fake(calls = []) {
  return new ClaudeCliAdapter({ spawn: (_command, args, options) => {
    calls.push(args);
    return spawn(process.execPath, [fixture], options);
  } });
}
async function collect(stream) {
  const events = [];
  for (;;) {
    const item = await stream.next();
    if (item.done) throw new Error('stream closed before completion');
    events.push(item.value);
    if (item.value.kind === 'turn_end' || item.value.kind === 'interrupted') return events;
  }
}

test('CLI runs a turn using stdin and resumes the native session', async () => {
  const calls = []; const adapter = fake(calls);
  const handle = await adapter.start({ cwd, mode: 'plan' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'first prompt' });
  const first = await collect(stream);
  assert.deepEqual(first.map((e) => e.kind), ['turn_start', 'agent_version', 'text', 'usage', 'turn_end']);
  assert.equal(first[2].text, 'first prompt');
  assert.ok(calls[0].includes('--permission-prompts'));
  assert.ok(calls[0].includes('none'));
  assert.equal(calls[0].includes('first prompt'), false);
  await adapter.prompt(handle, { text: 'second prompt' });
  await collect(stream);
  const index = calls[1].indexOf('--resume');
  assert.equal(calls[1][index + 1], 'native-test');
  await adapter.dispose(handle);
});

test('CLI does not claim success on malformed JSON or missing result', async () => {
  for (const prompt of ['bad-json', 'no-result']) {
    const adapter = fake(); const handle = await adapter.start({ cwd });
    const stream = adapter.events(handle)[Symbol.asyncIterator]();
    await adapter.prompt(handle, { text: prompt });
    const events = await collect(stream);
    assert.equal(events.at(-1).kind, 'interrupted');
    assert.equal(events.some((event) => event.kind === 'turn_end'), false);
    await adapter.dispose(handle);
  }
});

test('CLI refuses unsafe modes and reports missing executable', async () => {
  const adapter = new ClaudeCliAdapter({ executable: 'ormicode-command-that-does-not-exist' });
  await assert.rejects(adapter.start({ cwd, mode: 'bypassPermissions' }), /unsafe/);
  const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  const events = await collect(stream);
  assert.equal(events.at(-1).kind, 'interrupted');
  await adapter.dispose(handle);
});

test('detect checks the executable without claiming authentication', async () => {
  const found = await new ClaudeCliAdapter({ readVersion: async () => '2.1.325 (Claude Code)' }).detect();
  assert.equal(found.available, true);
  assert.equal(found.version, '2.1.325');
  assert.match(found.reason, /authentication not checked/);
  const missing = await new ClaudeCliAdapter({ executable: 'ormicode-command-that-does-not-exist' }).detect();
  assert.equal(missing.available, false);
  const old = await new ClaudeCliAdapter({ readVersion: async () => '2.1.258 (Claude Code)' }).detect();
  assert.equal(old.available, false);
  assert.match(old.reason, /2\.1\.259/);
  const boundary = await new ClaudeCliAdapter({ readVersion: async () => '2.1.259 (Claude Code)' }).detect();
  assert.equal(boundary.available, true);
  const unknown = await new ClaudeCliAdapter({ readVersion: async () => 'not Claude' }).detect();
  assert.equal(unknown.available, false);
});

test('CLI rejects oversized lines and nonzero exits', async () => {
  for (const prompt of ['oversized', 'nonzero']) {
    const adapter = fake(); const handle = await adapter.start({ cwd });
    const stream = adapter.events(handle)[Symbol.asyncIterator]();
    await adapter.prompt(handle, { text: prompt });
    const events = await collect(stream);
    assert.equal(events.at(-1).kind, 'interrupted');
    assert.equal(events.some((event) => event.kind === 'turn_end'), false);
    const error = (await stream.next()).value;
    assert.equal(error.kind, 'error');
    if (prompt === 'oversized') assert.match(error.message, /size limit/);
    else assert.match(error.message, /code 7/);
    await adapter.dispose(handle);
  }
});

test('a structured error result is a completed failed turn even with a nonzero exit', async () => {
  const adapter = fake(); const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'result-error' });
  const events = await collect(stream);
  assert.deepEqual(events.map((event) => event.kind), ['turn_start', 'usage', 'error', 'turn_end']);
  assert.equal(events[2].code, 'plan_limit');
  await adapter.dispose(handle);
});

test('configuration is applied to the next turn and rejects unsupported values', async () => {
  const calls = []; const adapter = fake(calls);
  const spec = { cwd, mode: 'default', model: 'first' };
  const handle = await adapter.start(spec);
  spec.model = 'changed-externally';
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'first' });
  await collect(stream);
  assert.equal(calls[0][calls[0].indexOf('--model') + 1], 'first');
  await assert.rejects(adapter.setMode(handle, 'bypassPermissions'), /unsafe/);
  await assert.rejects(adapter.setEffort(handle, 'made-up'), /Unsupported/);
  await adapter.setModel(handle, 'new-model');
  await adapter.setEffort(handle, 'high');
  await adapter.setMode(handle, 'plan');
  assert.deepEqual((await stream.next()).value, { kind: 'model_changed', model: 'new-model', effective: 'next_turn' });
  assert.deepEqual((await stream.next()).value, { kind: 'effort_changed', effort: 'high', effective: 'next_turn' });
  assert.deepEqual((await stream.next()).value, { kind: 'mode_changed', mode: 'plan', effective: 'next_turn' });
  await adapter.prompt(handle, { text: 'second' });
  await collect(stream);
  assert.equal(calls[1][calls[1].indexOf('--model') + 1], 'new-model');
  assert.equal(calls[1][calls[1].indexOf('--effort') + 1], 'high');
  assert.equal(calls[1][calls[1].indexOf('--permission-mode') + 1], 'plan');
  await adapter.dispose(handle);
});

test('a mismatched native session ID interrupts and blocks further prompts', async () => {
  const adapter = fake(); const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'first' });
  await collect(stream);
  await adapter.prompt(handle, { text: 'mismatch' });
  const events = await collect(stream);
  assert.equal(events.at(-1).kind, 'interrupted');
  assert.match((await stream.next()).value.message, /different native session ID/);
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /inconsistent/);
  await adapter.dispose(handle);
});

test('a failed stdin write does not report a partial prompt as successful', async () => {
  const closed = fileURLToPath(new URL('./fixtures/closed-stdin.mjs', import.meta.url));
  const adapter = new ClaudeCliAdapter({ spawn: (_command, _args, options) => spawn(process.execPath, [closed], options) });
  const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'x'.repeat(4 * 1024 * 1024) });
  const events = await collect(stream);
  assert.equal(events.at(-1).kind, 'interrupted');
  assert.equal(events.some((event) => event.kind === 'turn_end'), false);
  assert.match((await stream.next()).value.message, /complete prompt/);
  await assert.rejects(adapter.prompt(handle, { text: 'retry' }), /explicit recovery/);
  await adapter.dispose(handle);
});

test('configuration changes are rejected while a turn is running', async () => {
  const adapter = fake(); const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hold' });
  await assert.rejects(adapter.setModel(handle, 'model-b'), /active turn/);
  await assert.rejects(adapter.setMode(handle, 'plan'), /active turn/);
  await assert.rejects(adapter.setEffort(handle, 'high'), /active turn/);
  await collect(stream);
  await adapter.dispose(handle);
});

test('opt-in bridge does not place its token in CLI arguments', async () => {
  let capturedArgs; let leaked = true; let tokenSet = false;
  const adapter = new ClaudeCliAdapter({ approvalBridge: true, spawn: (_command, args, options) => {
    capturedArgs = args;
    const token = options.env?.ORMICODE_CLI_APPROVAL_TOKEN;
    tokenSet = typeof token === 'string' && token.length > 20;
    leaked = args.some((arg) => token && arg.includes(token));
    return spawn(process.execPath, [fixture], options);
  } });
  const handle = await adapter.start({ cwd });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  await collect(stream);
  assert.equal(tokenSet, true);
  assert.equal(leaked, false);
  assert.equal(capturedArgs[capturedArgs.indexOf('--permission-prompts') + 1], 'host');
  assert.match(capturedArgs[capturedArgs.indexOf('--permission-prompt-tool') + 1], /^mcp__ormicode_[0-9a-hjkmnp-tv-z]{26}__approve$/);
  await adapter.dispose(handle);
});

test('CLI approval bridge forwards and returns both decisions end to end', async () => {
  const bridgeFixture = fileURLToPath(new URL('./fixtures/bridge-fixture.mjs', import.meta.url));
  for (const choice of ['allow', 'deny']) {
    const adapter = new ClaudeCliAdapter({ approvalBridge: true, spawn: (_command, args, options) => spawn(process.execPath, [bridgeFixture, ...args], options) });
    const handle = await adapter.start({ cwd });
    const stream = adapter.events(handle)[Symbol.asyncIterator]();
    await adapter.prompt(handle, { text: 'test' });
    let requested = false; let answer = '';
    for (;;) {
      const { value: event, done } = await stream.next();
      if (done) throw new Error('stream closed');
      if (event.kind === 'approval_request') {
        requested = true;
        assert.equal(event.toolUseId, 'fixture-call');
        await adapter.approve(handle, event.request, choice);
      }
      if (event.kind === 'text') answer += event.text;
      if (event.kind === 'interrupted') throw new Error(event.reason);
      if (event.kind === 'turn_end') break;
    }
    assert.equal(requested, true);
    assert.equal(answer, choice);
    await adapter.dispose(handle);
  }
});

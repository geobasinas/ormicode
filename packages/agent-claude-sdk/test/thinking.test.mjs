import assert from 'node:assert/strict';
import test from 'node:test';
import { ThinkingCapture } from '../src/thinking.ts';
import { ClaudeSdkAdapter } from '../src/index.ts';

test('SDK turns request thinking summaries and retain streamed text durably', async () => {
  for (const ending of ['complete', 'empty', 'error']) {
    const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
      assert.deepEqual(options.thinking, { type: 'enabled', display: 'summarized' });
      yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Inspect the files.' } } };
      if (ending === 'error') throw new Error('connection lost');
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'thinking', thinking: ending === 'empty' ? '' : 'Inspect the files.' }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    })() });
    const handle = await adapter.start({ cwd: '/repo' });
    const stream = adapter.events(handle)[Symbol.asyncIterator]();
    await adapter.prompt(handle, { text: 'inspect' });
    const received = [];
    while (true) {
      const event = (await stream.next()).value;
      received.push(event);
      if (event.kind === 'turn_end' || ending === 'error' && event.kind === 'thinking') break;
    }
    assert.deepEqual(received.filter(event => event.kind === 'thinking'), [{ kind: 'thinking', text: 'Inspect the files.' }]);
    await adapter.dispose(handle);
  }
});

test('retains streamed thinking when the completed block is empty', () => {
  const capture = new ThinkingCapture();
  capture.accept([{ kind: 'thinking_delta', text: 'Let me ' }, { kind: 'thinking_delta', text: 'inspect this.' }]);
  assert.deepEqual(capture.accept([{ kind: 'thinking', text: '' }]), [{ kind: 'thinking', text: 'Let me inspect this.' }]);
  assert.deepEqual(capture.flush(), []);
});

test('prefers completed text and avoids duplicate durable thinking', () => {
  const capture = new ThinkingCapture();
  capture.accept([{ kind: 'thinking_delta', text: 'partial' }]);
  assert.deepEqual(capture.accept([{ kind: 'thinking', text: 'complete' }, { kind: 'turn_end' }]), [{ kind: 'thinking', text: 'complete' }, { kind: 'turn_end' }]);
  assert.deepEqual(capture.accept([{ kind: 'thinking', text: '' }]), []);
});

test('flushes delta-only thinking on completion and interruption', () => {
  for (const end of [{ kind: 'turn_end' }, { kind: 'interrupted', reason: 'sdk_error' }]) {
    const capture = new ThinkingCapture();
    capture.accept([{ kind: 'thinking_delta', text: 'still useful' }]);
    assert.deepEqual(capture.accept([end]), [{ kind: 'thinking', text: 'still useful' }, end]);
    assert.deepEqual(capture.flush(), []);
  }
});

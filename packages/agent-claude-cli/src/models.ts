import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ModelList } from '@ormicode/agent-core';

export type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
interface WireModel { value?: unknown; displayName?: unknown; supportedEffortLevels?: unknown }
const REQUEST_ID = 'ormicode_models';
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * `claude` has no model-listing flag, but the stream-json control channel publishes the
 * catalog: spawn with `--await-initialize`, send the `initialize` control request and read
 * `models` from its response — the same list the SDK's `supportedModels()` returns, with no
 * SDK dependency. The process is killed as soon as the response (or a failure) arrives.
 */
export async function listClaudeModels(options: { executable?: string; spawn?: Spawn; timeoutMs?: number } = {}): Promise<ModelList> {
  const child = (options.spawn ?? nodeSpawn)(options.executable ?? 'claude', ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--await-initialize'], { windowsHide: true, shell: false });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  child.stdin.on('error', () => { /* surfaced by the close/timeout paths */ });
  const send = (frame: object) => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(frame)}\n`); };
  try {
    return await new Promise<ModelList>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('claude model probe timed out')), options.timeoutMs ?? 15_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once('error', () => fail(new Error('claude CLI failed to start')));
      child.once('close', () => fail(new Error('claude CLI closed before answering initialize')));
      lines.on('line', (line) => {
        if (line.length > MAX_LINE_BYTES) return fail(new Error('claude CLI message exceeded size limit'));
        let frame: { type?: unknown; request_id?: unknown; response?: { subtype?: unknown; request_id?: unknown; response?: { models?: unknown }; error?: unknown } };
        try { frame = JSON.parse(line); } catch { return fail(new Error('Invalid claude control frame')); }
        // CLI-initiated control requests are not expected during initialize; refuse them so the CLI never waits.
        if (frame.type === 'control_request') { send({ type: 'control_response', response: { subtype: 'error', request_id: frame.request_id, error: 'Unsupported' } }); return; }
        if (frame.type !== 'control_response' || frame.response?.request_id !== REQUEST_ID) return;
        if (frame.response.subtype !== 'success') return fail(new Error(`claude initialize refused: ${String(frame.response.error ?? 'unknown')}`));
        const models = frame.response.response?.models;
        if (!Array.isArray(models) || !models.every((model: WireModel) => typeof model?.value === 'string' && model.value)) return fail(new Error('Invalid claude initialize response'));
        clearTimeout(timer);
        resolve(models.map((model: WireModel) => {
          const efforts = Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels.filter((effort): effort is string => typeof effort === 'string') : [];
          return { id: model.value as string, ...(typeof model.displayName === 'string' && model.displayName ? { name: model.displayName } : {}), ...(efforts.length ? { efforts } : {}) };
        }));
      });
      send({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'initialize' } });
    });
  } finally {
    lines.close(); child.stdin.end(); child.kill();
  }
}

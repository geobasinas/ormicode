import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { createInterface } from 'node:readline';

export type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
export interface CodexModel { id: string; name?: string; efforts?: string[] }
interface WireModel { id?: unknown; displayName?: unknown; hidden?: unknown; supportedReasoningEfforts?: { reasoningEffort?: unknown }[] }

/**
 * @openai/codex-sdk has no model list, so ask the same `codex` binary over its official
 * app-server stdio protocol: initialize, initialized, then `model/list`. The process is
 * killed as soon as the list (or a failure) arrives.
 */
export async function listCodexModels(options: { executable?: string; spawn?: Spawn; timeoutMs?: number } = {}): Promise<CodexModel[]> {
  const child = (options.spawn ?? nodeSpawn)(options.executable ?? 'codex', ['app-server', '--listen', 'stdio://'], { windowsHide: true, shell: false });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  child.stdin.on('error', () => { /* surfaced by the close/timeout paths */ });
  const send = (frame: object) => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(frame)}\n`); };
  try {
    return await new Promise<CodexModel[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('codex model/list timed out')), options.timeoutMs ?? 30_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once('error', () => fail(new Error('codex app-server failed to start')));
      child.once('close', () => fail(new Error('codex app-server closed before model/list')));
      lines.on('line', (line) => {
        let frame: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
        try { frame = JSON.parse(line); } catch { return fail(new Error('Invalid app-server JSONL frame')); }
        // Server requests are not expected during model/list; refuse them so the server never waits.
        if (frame.method !== undefined) { if (frame.id !== undefined) send({ id: frame.id, error: { code: -32601, message: 'Unsupported' } }); return; }
        if (frame.error) return fail(new Error(`codex app-server error: ${String(frame.error.message ?? 'unknown')}`));
        if (frame.id === 1) {
          const init = frame.result as { userAgent?: unknown } | undefined;
          if (typeof init?.userAgent !== 'string') return fail(new Error('Invalid app-server initialize response'));
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'model/list', params: {} });
        } else if (frame.id === 2) {
          const data = (frame.result as { data?: unknown } | undefined)?.data;
          if (!Array.isArray(data) || !data.every((model: WireModel) => typeof model?.id === 'string' && model.id)) return fail(new Error('Invalid model/list response'));
          clearTimeout(timer);
          resolve((data as WireModel[]).filter((model) => !model.hidden).map((model) => {
            const efforts = (model.supportedReasoningEfforts ?? []).map((entry) => entry.reasoningEffort).filter((effort): effort is string => typeof effort === 'string');
            return { id: model.id as string, ...(typeof model.displayName === 'string' && model.displayName ? { name: model.displayName } : {}), ...(efforts.length ? { efforts } : {}) };
          }));
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ormicode', title: 'ormicode', version: '0.0.0' }, capabilities: null } });
    });
  } finally {
    lines.close(); child.stdin.end(); child.kill();
  }
}

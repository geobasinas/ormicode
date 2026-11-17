import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@ormicode/protocol';
import type { AgentAdapter, Handle } from './adapter.ts';
import { validateTurn } from './validate-turn.ts';
import { validateCapabilities } from './adapter.ts';

export interface SmokeHooks { onNativeId?: (handle: Handle, id: string) => void }
export interface SmokeOptions {
  create: (hooks: SmokeHooks) => AgentAdapter | Promise<AgentAdapter>;
  repo?: string;
  home?: string;
  kill?: boolean;
  approve?: string;
  keep?: boolean;
  prompt?: string;
  toolPrompt?: string;
  timeoutMs?: number;
}
export interface SmokeStep { step: string; status: 'ok' | 'fail' | 'unverified'; detail?: string }

const nextEvent = async (stream: AsyncIterator<AgentEvent>, timeoutMs: number): Promise<AgentEvent | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    stream.next().then(r => r.done ? undefined : r.value),
    new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); }),
  ]);
  clearTimeout(timer);
  return result;
};

async function collectTurn(adapter: AgentAdapter, handle: Handle, text: string, opts: { timeoutMs: number; approve?: string; seen: SmokeStep[] }): Promise<{ events: AgentEvent[]; failed?: string }> {
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  const events: AgentEvent[] = [];
  const prompting = adapter.prompt(handle, { text }).catch(error => ({ promptError: error instanceof Error ? error : new Error(String(error)) }));
  try {
    while (true) {
      const event = await nextEvent(stream, opts.timeoutMs);
      if (!event) return { events, failed: 'timed out waiting for turn end' };
      events.push(event);
      if (event.kind === 'approval_request') {
        if (opts.approve) await adapter.approve!(handle, event.request, opts.approve);
        else opts.seen.push({ step: 'approval', status: 'unverified', detail: 'approval_request arrived without --approve' });
      }
      if (event.kind === 'turn_end') return { events };
      if (event.kind === 'interrupted') return { events, failed: `interrupted: ${event.reason}` };
    }
  } finally {
    const outcome = await prompting;
    if (outcome?.promptError && !events.some(e => e.kind === 'interrupted')) events.push({ kind: 'error', code: 'unknown', message: outcome.promptError.message } as AgentEvent);
    await stream.return?.();
  }
}

/** Shared smoke harness: detect, fixed prompt, tool turn, optional kill, resume. Prints each step; exit code decided by caller. */
export async function smokeAdapter(vendor: string, transport: string, options: SmokeOptions): Promise<SmokeStep[]> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const prompt = options.prompt ?? 'Reply with exactly: ok';
  const toolPrompt = options.toolPrompt ?? 'List the files in the current directory using a tool call, then reply briefly.';
  const steps: SmokeStep[] = [];
  const fail = (step: string, detail: string) => { steps.push({ step, status: 'fail', detail }); return false; };
  const ok = (step: string, detail?: string) => { steps.push({ step, status: 'ok', ...(detail ? { detail } : {}) }); return true; };
  const unverified = (step: string, detail: string) => steps.push({ step, status: 'unverified', detail });

  let nativeId: string | undefined;
  let adapter: AgentAdapter;
  try { adapter = await options.create({ onNativeId: (_handle, id) => { nativeId = id; } }); }
  catch (error) { fail('detect', error instanceof Error ? error.message : String(error)); return steps; }

  // --home redirects logins/config for the spawned agent without touching the caller's env afterwards.
  const savedHome: Record<string, string | undefined> = {};
  if (options.home) {
    for (const key of ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']) { savedHome[key] = process.env[key]; delete process.env[key]; }
    process.env.HOME = options.home;
    if (process.platform === 'win32') process.env.USERPROFILE = options.home;
  }
  const restoreHome = () => { for (const [key, value] of Object.entries(savedHome)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };

  const detection = await adapter.detect().catch(() => ({ available: false } as { available: boolean; version?: string; reason?: string }));
  if (!detection.available) { restoreHome(); fail('detect', detection.reason ?? 'not available'); return steps; }
  ok('detect', detection.version);

  const capProblems = validateCapabilities(adapter);
  const claimed = Object.entries(adapter.capabilities).filter(([, v]) => v).map(([k]) => k);
  capProblems.length ? fail('capabilities', capProblems.join('; ')) : ok('capabilities', claimed.length ? claimed.join(', ') : 'none claimed');

  const models = await adapter.models().catch(() => undefined);
  models === undefined ? fail('models', 'models() threw')
    : models.length ? ok('models', `${models.length} model(s), first: ${models[0].id}`)
    : unverified('models', 'empty model list');

  const own = !options.repo;
  const repo = options.repo ?? await mkdtemp(join(tmpdir(), `ormi-smoke-${vendor}-`));
  try {
    const handle = await adapter.start({ cwd: repo });
    ok('start');

    const first = await collectTurn(adapter, handle, prompt, { timeoutMs, approve: options.approve, seen: steps });
    if (first.failed) fail('turn', first.failed);
    else {
      const problems = validateTurn(first.events);
      problems.length ? fail('turn', problems.join('; ')) : ok('turn', `${first.events.length} events`);
    }

    const tool = await collectTurn(adapter, handle, toolPrompt, { timeoutMs, approve: options.approve, seen: steps });
    if (tool.failed) fail('tool', tool.failed);
    else if (!tool.events.some(e => e.kind === 'tool_call')) unverified('tool', 'no tool_call observed');
    else if (!tool.events.some(e => e.kind === 'tool_result')) fail('tool', 'tool_call without tool_result');
    else ok('tool');

    if (options.kill) {
      // A fresh session: an earlier failed turn may have left this one in recovery.
      const killHandle = await adapter.start({ cwd: repo }).catch(() => undefined);
      const stream = killHandle ? adapter.events(killHandle)[Symbol.asyncIterator]() : undefined;
      const prompting = killHandle ? adapter.prompt(killHandle, { text: 'Count slowly from 1 to 500, one number per line.' }).catch(() => undefined) : undefined;
      const firstEvent = stream ? await nextEvent(stream, 30_000) : undefined;
      if (adapter.interrupt && firstEvent && killHandle) {
        await adapter.interrupt(killHandle).catch(() => undefined);
        let interrupted = false; let leftover = 0;
        while (leftover++ < 64) {
          const event = await nextEvent(stream!, 15_000);
          if (!event) break;
          if (event.kind === 'interrupted') { interrupted = true; break; }
          if (event.kind === 'turn_end') break;
        }
        interrupted ? ok('kill') : fail('kill', 'no interrupted event after interrupt');
      } else unverified('kill', adapter.interrupt ? 'no turn started' : 'adapter has no interrupt');
      await prompting;
      if (stream) await stream.return?.();
      if (killHandle) await adapter.dispose(killHandle).catch(() => undefined);
    }

    if (typeof adapter.resume === 'function' && nativeId === undefined) unverified('resume', 'adapter reported no native session id');
    else if (typeof adapter.resume === 'function') {
      try {
        const resumed = await adapter.resume({ id: nativeId!, cwd: repo });
        const again = await collectTurn(adapter, resumed, prompt, { timeoutMs, approve: options.approve, seen: steps });
        await adapter.dispose(resumed);
        again.failed ? fail('resume', again.failed) : ok('resume');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // A resume failure on an adapter that claims resume is a regression; on one
        // that doesn't it's evidence the vendor can't reload sessions — not a defect.
        adapter.capabilities.resume ? fail('resume', reason) : unverified('resume', `native reload unsupported: ${reason}`);
      }
    } else unverified('resume', 'adapter does not implement resume');

    await adapter.dispose(handle);
  } catch (error) {
    fail('session', error instanceof Error ? error.message : String(error));
  } finally {
    restoreHome();
    if (own && !options.keep) await rm(repo, { recursive: true, force: true }).catch(() => undefined);
  }
  return steps;
}

export function reportSmoke(vendor: string, transport: string, steps: SmokeStep[]): number {
  for (const step of steps) console.log(`smoke ${vendor}/${transport} ${step.step}: ${step.status}${step.detail ? ` — ${step.detail}` : ''}`);
  const failed = steps.filter(s => s.status === 'fail').length;
  console.log(`smoke ${vendor}/${transport} done: ${steps.length - failed}/${steps.length} steps`);
  return failed ? 1 : 0;
}

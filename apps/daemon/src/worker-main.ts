import { connect } from './socket.ts';
import { createAdapter } from './registry.ts';
import type { AgentAdapter, Handle } from '@ormicode/agent-core';
import type { Frame } from '@ormicode/protocol';

/**
 * One process per live session. Env: ORMICODE_SOCKET, ORMICODE_SESSION,
 * ORMICODE_VENDOR, ORMICODE_TRANSPORT, ORMICODE_CWD, ORMICODE_RESUME,
 * ORMICODE_AGENT_COMMAND/ARGS_JSON (generic ACP), ORMICODE_FAKE_SCRIPT.
 * Talks the worker.* protocol; stops if the supervisor link is lost.
 */
const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; };

const session = env('ORMICODE_SESSION');
const vendor = env('ORMICODE_VENDOR');
const transport = env('ORMICODE_TRANSPORT') || 'cli';
const cwd = env('ORMICODE_CWD');
const link = await connect(env('ORMICODE_SOCKET'));

const send = async (method: string, body: Record<string, unknown>) => {
  try { return await link.request(method, body, 15_000); }
  catch { process.exit(2); } // supervisor gone: never buffer unboundedly
};

let adapter: AgentAdapter | undefined;
let handle: Handle | undefined;
let pumping = false;

const pump = () => {
  if (!adapter || !handle || pumping) return;
  pumping = true;
  (async () => {
    for await (const event of adapter!.events(handle!)) {
      const { kind, ...rest } = event as { kind: string } & Record<string, unknown>;
      await send('worker.event', { session, kind, payload: rest, ts: Date.now() });
    }
    await send('worker.event', { session, kind: 'interrupted', payload: { reason: 'stream_ended' }, ts: Date.now() });
  })().catch(async error => {
    await send('worker.event', { session, kind: 'error', payload: { code: 'worker.error', message: String(error) }, ts: Date.now() });
    process.exit(1);
  });
};

const fail = (id: string, code: string, message: string) => link.replyError(id, code, message);

link.onFrame = async (frame: Frame) => {
  if (frame.type !== 'req') return;
  const { id, method } = frame as { id: string; method: string };
  const body = (frame as { body?: Record<string, unknown> }).body ?? {};
  try {
    switch (method) {
      case 'worker.prompt':
        if (!adapter || !handle) return fail(id, 'agent.failed', 'no live session');
        await adapter.prompt(handle, { text: String(body.text ?? ''), ...(Array.isArray(body.images) ? { images: body.images as never } : {}) });
        link.reply(id, { accepted: true });
        break;
      case 'worker.steer':
        if (!adapter?.steer || !handle) return fail(id, 'agent.unsupported', 'no steer');
        await adapter.steer(handle, { text: String(body.text ?? '') });
        link.reply(id, { accepted: true });
        break;
      case 'worker.decide':
        if (!adapter?.approve || !handle) return fail(id, 'agent.unsupported', 'no approvals');
        await adapter.approve(handle, String(body.request), String(body.option));
        link.reply(id, { decided: true });
        break;
      case 'worker.answer':
        if (!adapter?.answerQuestion || !handle) return fail(id, 'agent.unsupported', 'no answerQuestion');
        await adapter.answerQuestion(handle, String(body.request), body.answers as Record<string, string>);
        link.reply(id, { answered: true });
        break;
      case 'worker.abort':
        if (!adapter?.interrupt || !handle) return fail(id, 'agent.unsupported', 'no interrupt');
        await adapter.interrupt(handle);
        link.reply(id, { interrupted: true });
        break;
      case 'worker.configure': {
        if (!handle || !adapter) return fail(id, 'agent.failed', 'no live session');
        const kind = String(body.kind); const value = String(body.value);
        const fn = kind === 'model' ? adapter.setModel : kind === 'effort' ? adapter.setEffort
          : kind === 'mode' ? adapter.setMode : undefined;
        if (!fn) {
          if (kind === 'option' && adapter.setOption) { await adapter.setOption(handle, String(body.id), body.value as string | boolean); return link.reply(id, { updated: true }); }
          return fail(id, 'agent.unsupported', `no ${kind}`);
        }
        await fn.call(adapter, handle, value);
        link.reply(id, { updated: true });
        break;
      }
      case 'worker.evict':
        if (adapter && handle) await adapter.dispose(handle).catch(() => undefined);
        link.reply(id, { evicted: true });
        process.exit(0);
        break;
      default:
        fail(id, 'protocol.unknown_method', method);
    }
  } catch (error) {
    fail(id, 'agent.failed', error instanceof Error ? error.message : String(error));
  }
};
link.onClose = () => process.exit(2);

try {
  adapter = await createAdapter(vendor, transport, {
    ...(process.env.ORMICODE_AGENT_COMMAND ? { agentCommand: process.env.ORMICODE_AGENT_COMMAND } : {}),
    ...(process.env.ORMICODE_AGENT_ARGS_JSON ? { agentArgs: JSON.parse(process.env.ORMICODE_AGENT_ARGS_JSON) as string[] } : {}),
    onNativeId: id => { void send('worker.native', { session, nativeId: id }); },
  });
  const resumeId = process.env.ORMICODE_RESUME;
  handle = resumeId && adapter.resume
    ? await adapter.resume({ id: resumeId, cwd })
    : await adapter.start({ cwd, ...(process.env.ORMICODE_MODEL ? { model: process.env.ORMICODE_MODEL } : {}) });
  // Adapters either push native ids via onNativeId or expose nativeId(handle).
  const probe = (adapter as { nativeId?: (h: Handle) => string }).nativeId;
  if (probe) { const id = probe.call(adapter, handle); if (id) void send('worker.native', { session, nativeId: id }); }
  pump();
  await send('worker.ready', { session, pid: process.pid });
  setInterval(() => { void send('worker.health', { pid: process.pid, rssBytes: process.memoryUsage().rss }).catch(() => undefined); }, 10_000).unref();
} catch (error) {
  await send('worker.event', { session, kind: 'error', payload: { code: 'worker.start_failed', message: error instanceof Error ? error.message : String(error) }, ts: Date.now() }).catch(() => undefined);
  process.exit(1);
}

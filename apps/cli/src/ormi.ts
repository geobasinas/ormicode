#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as daemonSocket from '@ormicode/daemon';
import { newId } from '@ormicode/protocol';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const transports: Record<string, string[]> = {
  claude: ['sdk', 'cli'],
  codex: ['sdk'],
  opencode: ['sdk', 'cli', 'acp'],
  pi: ['sdk', 'cli'],
  grok: ['cli', 'acp'],
  vibe: ['cli', 'acp'],
};

function usage(code: number): never {
  console.log(`usage:
  ormi agent smoke <vendor> [--transport sdk|cli|acp] [--repo <dir>] [--home <dir>] [--kill] [--approve <optionId>] [--keep]
  ormi agent smoke <vendor> --command <acp-cmd> [--args "..."]   (third-party ACP agent)
  ormi daemon                                     run the supervisor in the foreground
  ormi status                                     daemon.status
  ormi session start <vendor> [--transport t]     start a session, prints its id
  ormi session list [--archived]
  ormi session get <id>
  ormi session prompt <id> <text>
  ormi session steer <id> <text>                  steer mid-turn
  ormi session abort|pause|resume|retry|delete|archive <id>
  ormi session decide <id> <requestId> <optionId>
  ormi session answer <id> <requestId> '<json>'
  ormi session set <id> model|effort|mode|option <value>
  ormi session note <id> <title> [body]
  ormi session notes <id>
  ormi session tail <id>                          stream live + replayed events`);
  process.exit(code);
}

const passthrough = ['--repo', '--home', '--approve', '--command', '--args', '--vendor', '--v1'];
const flags = ['--kill', '--keep'];

function forward(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.includes(arg)) out.push(arg);
    else if (passthrough.includes(arg)) { out.push(arg); if (args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[++i]); }
  }
  return out;
}

async function runScript(script: string, extra: string[]): Promise<number> {
  if (!existsSync(script)) { console.log(`smoke: no smoke script at ${script} (unverified)`); return -1; }
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...extra], { stdio: 'inherit', cwd: root, windowsHide: true, shell: false });
    child.on('error', () => resolve(1));
    child.on('close', code => resolve(code ?? 1));
  });
}

async function agentSmoke(vendor: string, args: string[]): Promise<number> {
  // The fake adapter runs in-process: no vendor binary or credentials needed.
  if (vendor === 'fake') {
    const { FakeAdapter, smokeAdapter, reportSmoke } = await import('@ormicode/agent-core');
    const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const script = flag('--script');
    if (script && !['echo', 'slow', 'tool', 'approval', 'ratelimit'].includes(script)) { console.error(`unknown fake script ${script}`); return usage(2); }
    const code = reportSmoke('fake', 'inprocess', await smokeAdapter('fake', 'inprocess', {
      create: () => new FakeAdapter({ ...(script ? { script: script as 'echo' | 'slow' | 'tool' | 'approval' | 'ratelimit' } : {}) }),
      repo: flag('--repo'),
      home: flag('--home'),
      kill: args.includes('--kill'),
      approve: flag('--approve'),
      keep: args.includes('--keep'),
      timeoutMs: 10_000,
    }));
    return code;
  }
  const ti = args.indexOf('--transport');
  const wanted = ti >= 0 ? args[ti + 1] : undefined;
  if (wanted && !['sdk', 'cli', 'acp'].includes(wanted)) { console.error(`unknown transport ${wanted}`); return usage(2); }
  const rest = forward(args.filter((_, i) => i !== ti && i !== ti + 1));

  // Third-party agents go through the generic ACP smoke when a command is given.
  if (args.includes('--command') || (!transports[vendor] && process.env.ORMICODE_ACP_COMMAND)) {
    return runScript(join(root, 'packages/agent-acp/scripts/smoke.ts'), ['--vendor', vendor, ...rest]);
  }
  const list = (transports[vendor] ?? []).filter(t => !wanted || t === wanted);
  if (!list.length) { console.error(`unknown vendor ${vendor} (known: ${Object.keys(transports).join(', ')}, or pass --command for a third-party ACP agent)`); return usage(2); }

  let failed = 0; let missing = 0;
  for (const transport of list) {
    const code = await runScript(join(root, `packages/agent-${vendor}-${transport}/scripts/smoke.ts`), rest);
    if (code === -1) missing++;
    else if (code !== 0) failed++;
  }
  if (missing === list.length) { console.log(`smoke ${vendor}: no transports implemented`); return 2; }
  console.log(`smoke ${vendor}: ${failed ? `${failed} transport(s) failed` : 'all implemented transports passed'}${missing ? `, ${missing} missing` : ''}`);
  return failed ? 1 : 0;
}

const socketPath = () => {
  const { defaultSocketPath } = daemonSocket;
  return process.env.ORMICODE_SOCKET ?? defaultSocketPath();
};

async function withDaemon<T>(fn: (link: import('@ormicode/daemon').Link) => Promise<T>): Promise<T> {
  const link = await daemonSocket.connect(socketPath()).catch(() => {
    console.error(`no daemon on ${socketPath()} — start one with \`ormi daemon\``);
    process.exit(2);
  });
  try { return await fn(link); } finally { link.close(); }
}

async function daemonMain(): Promise<number> {
  const { startDaemon } = await import('@ormicode/daemon');
  const daemon = await startDaemon();
  console.log(`ormicode daemon listening on ${daemon.socketPath}`);
  await new Promise<void>(resolve => {
    process.on('SIGINT', resolve); process.on('SIGTERM', resolve);
  });
  await daemon.close();
  return 0;
}

async function sessionCommand(verb: string, args: string[]): Promise<number> {
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  return withDaemon(async link => {
    switch (verb) {
      case 'start': {
        const vendor = args[0];
        if (!vendor) { console.error('usage: ormi session start <vendor> [--transport t] [--project p] [--model m] [--effort e] [--mode m] [--agentCommand c]'); return 2; }
        const res = await link.request('session.start', {
          machine: newId('m'), project: flag('--project') ?? process.cwd(),
          vendor, transport: flag('--transport') ?? 'cli',
          model: flag('--model') ?? 'default', effort: flag('--effort') ?? 'default', mode: flag('--mode') ?? 'default',
          workspace: { kind: 'current' },
          ...(flag('--agentCommand') ? { agentCommand: flag('--agentCommand') } : {}),
        });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        console.log((res.body as { session: string }).session);
        return 0;
      }
      case 'list': {
        const res = await link.request('session.list', { archived: args.includes('--archived') });
        for (const s of (res.body as { sessions: { id: string; title: string | null; state: string; vendor: string; transport: string }[] }).sessions)
          console.log(`${s.id}\t${s.state}\t${s.vendor}/${s.transport}\t${s.title ?? ''}`);
        return 0;
      }
      case 'get': {
        const res = await link.request('session.get', { session: args[0] });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        console.log(JSON.stringify(res.body, null, 2));
        return 0;
      }
      case 'prompt': {
        const [session, ...words] = args;
        const res = await link.request('session.prompt', { session, text: words.join(' ') });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'abort': case 'pause': case 'resume': case 'retry': case 'delete': case 'archive': {
        const res = await link.request(`session.${verb}`, { session: args[0] });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'steer': {
        const [session, ...words] = args;
        const res = await link.request('session.steer', { session, text: words.join(' ') });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'decide': {
        const res = await link.request('session.decide', { session: args[0], request: args[1], option: args[2] });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'answer': {
        const res = await link.request('session.answer', { session: args[0], request: args[1], answers: JSON.parse(args[2] ?? '{}') });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'set': {
        const [session, field, ...rest] = args;
        const method = { model: 'session.setModel', effort: 'session.setEffort', mode: 'session.setMode', option: 'session.setOption' }[field];
        if (!method) { console.error('usage: ormi session set <id> model|effort|mode|option <value>'); return 2; }
        const res = await link.request(method, field === 'option' ? { session, id: rest[0], value: rest[1] } : { session, [field]: rest.join(' ') });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'note': {
        const [session, ...words] = args;
        const res = await link.request('session.setNotes', { session, title: words[0] ?? 'note', body: words.slice(1).join(' ') });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        return 0;
      }
      case 'notes': {
        const res = await link.request('session.getNotes', { session: args[0] });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        console.log(JSON.stringify(res.body, null, 2));
        return 0;
      }
      case 'tail': {
        const res = await link.request('session.subscribe', { session: args[0] });
        if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
        link.onFrame = frame => {
          if (frame.type === 'evt') {
            const body = frame.body as Record<string, unknown>;
            const seq = 'seq' in frame ? `#${frame.seq} ` : '';
            console.log(`${seq}${body.kind}${body.text ? ` ${body.text}` : ''}${body.reason ? ` (${body.reason})` : ''}`);
          }
        };
        await new Promise(() => undefined); // tail until Ctrl+C
        return 0;
      }
      default:
        console.error(`unknown session command ${verb}`);
        return 2;
    }
  });
}

const [group, command, ...rest] = process.argv.slice(2);
if (group === 'agent' && command === 'smoke') {
  const vendor = rest[0];
  if (!vendor || vendor.startsWith('--')) usage(2);
  process.exit(await agentSmoke(vendor, rest.slice(1)));
} else if (group === 'daemon' && !command) {
  process.exit(await daemonMain());
} else if (group === 'session' && command) {
  process.exit(await sessionCommand(command, rest));
} else if (group === 'status' && !command) {
  process.exit(await withDaemon(async link => {
    const res = await link.request('daemon.status', {});
    console.log(JSON.stringify(res.body));
    return 0;
  }));
} else if (!group || group === '--help' || group === '-h') usage(0);
else { console.error(`unknown command ${[group, command].filter(Boolean).join(' ')}`); usage(2); }

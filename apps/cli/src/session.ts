import { newId } from '@ormicode/protocol';
import { flag } from './usage.ts';
import { withDaemon } from './daemon.ts';

const fail = (res: { type: string; code?: string; message?: string }): 0 | 1 =>
  res.type === 'err' ? (console.error(`${res.code}: ${res.message}`), 1) : 0;

export async function sessionCommand(verb: string, args: string[]): Promise<number> {
  return withDaemon(async link => {
    switch (verb) {
      case 'start': {
        const vendor = args[0];
        const usage = 'usage: ormi session start <vendor> [--transport t] [--project p] [--scratch] [--worktree <base> [--branch-name <name>] [--include-dirty] | --existing <path>] [--model m] [--effort e] [--mode m] [--agentCommand c]';
        if (!vendor) { console.error(usage); return 2; }
        const scratch = args.includes('--scratch');
        const worktree = flag(args, '--worktree');
        const branchName = flag(args, '--branch-name');
        const existing = flag(args, '--existing');
        const includeDirty = args.includes('--include-dirty');
        if ((args.includes('--worktree') && !worktree) || (args.includes('--branch-name') && !branchName)
          || (args.includes('--existing') && !existing) || (worktree && existing)
          || worktree?.startsWith('--') || branchName?.startsWith('--') || existing?.startsWith('--')
          || ((branchName || includeDirty) && !worktree) || (scratch && (worktree || existing))) {
          console.error(usage);
          return 2;
        }
        const workspace = scratch ? { kind: 'scratch' as const }
          : existing ? { kind: 'existing' as const, path: existing }
            : worktree ? {
              kind: 'worktree' as const, branch: worktree,
              ...(branchName ? { name: branchName } : {}),
              ...(includeDirty ? { includeDirty: true } : {}),
            }
              : { kind: 'current' as const };
        const res = await link.request('session.start', {
          machine: newId('m'), project: scratch ? 'scratch' : flag(args, '--project') ?? process.cwd(),
          vendor, transport: flag(args, '--transport') ?? 'cli',
          model: flag(args, '--model') ?? 'default', effort: flag(args, '--effort') ?? 'default', mode: flag(args, '--mode') ?? 'default',
          workspace,
          ...(flag(args, '--agentCommand') ? { agentCommand: flag(args, '--agentCommand') } : {}),
        });
        if (res.type === 'err') return fail(res);
        console.log((res.body as { session: string }).session);
        return 0;
      }
      case 'list': {
        const res = await link.request('session.list', { archived: args.includes('--archived') });
        for (const s of (res.body as { sessions: { id: string; title: string | null; state: string; vendor: string; transport: string }[] }).sessions)
          console.log(`${s.id}\t${s.state}\t${s.vendor}/${s.transport}\t${s.title ?? ''}`);
        return 0;
      }
      case 'get': case 'notes': {
        const method = verb === 'get' ? 'session.get' : 'session.getNotes';
        const res = await link.request(method, { session: args[0] });
        if (res.type === 'err') return fail(res);
        console.log(JSON.stringify(res.body, null, 2));
        return 0;
      }
      case 'prompt': case 'steer': {
        const [session, ...words] = args;
        const res = await link.request(`session.${verb}`, { session, text: words.join(' ') });
        return fail(res);
      }
      case 'abort': case 'pause': case 'resume': case 'retry': case 'delete': case 'archive': {
        const res = await link.request(`session.${verb}`, { session: args[0] });
        return fail(res);
      }
      case 'decide': {
        const res = await link.request('session.decide', { session: args[0], request: args[1], option: args[2] });
        return fail(res);
      }
      case 'answer': {
        const res = await link.request('session.answer', { session: args[0], request: args[1], answers: JSON.parse(args[2] ?? '{}') });
        return fail(res);
      }
      case 'set': {
        const [session, field, ...rest] = args;
        const method = { model: 'session.setModel', effort: 'session.setEffort', mode: 'session.setMode', option: 'session.setOption' }[field];
        if (!method) { console.error('usage: ormi session set <id> model|effort|mode|option <value>'); return 2; }
        const res = await link.request(method, field === 'option' ? { session, id: rest[0], value: rest[1] } : { session, [field]: rest.join(' ') });
        return fail(res);
      }
      case 'note': {
        const [session, ...words] = args;
        const res = await link.request('session.setNotes', { session, title: words[0] ?? 'note', body: words.slice(1).join(' ') });
        return fail(res);
      }
      case 'tail': {
        const res = await link.request('session.subscribe', { session: args[0] });
        if (res.type === 'err') return fail(res);
        link.onFrame = frame => {
          if (frame.type === 'evt') {
            const body = frame.body as Record<string, unknown>;
            const seq = 'seq' in frame ? `#${frame.seq} ` : '';
            console.log(`${seq}${body.kind}${body.text ? ` ${body.text}` : ''}${body.reason ? ` (${body.reason})` : ''}`);
            if (typeof frame.seq === 'number') link.send({ v: 1, type: 'ack', session: frame.session, seq: frame.seq });
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

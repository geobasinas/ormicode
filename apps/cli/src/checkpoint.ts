import { withDaemon } from './daemon.ts';
import { flag } from './usage.ts';

const USAGE = 'usage: ormi checkpoint list <session> | diff <session> <from> [to] | restore <session> <id> [--conversation] | fork <session> <id> [--branch b]';

export async function checkpointCommand(verb: string | undefined, args: string[]): Promise<number> {
  const [session, id, to] = args;
  if (!verb || !session) { console.error(USAGE); return 2; }
  return withDaemon(async link => {
    const req = verb === 'list' ? link.request('checkpoint.list', { session })
      : !id ? undefined
      : verb === 'diff' ? link.request('checkpoint.diff', { session, from: id, ...(to && !to.startsWith('--') ? { to } : {}) })
      : verb === 'restore' ? link.request('checkpoint.restore', { session, id, mode: args.includes('--conversation') ? 'conversation' : 'files' })
      : verb === 'fork' ? link.request('checkpoint.fork', { session, id, ...(flag(args, '--branch') ? { branch: flag(args, '--branch') } : {}) })
      : undefined;
    if (!req) { console.error(USAGE); return 2; }
    const res = await req;
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    const body = res.body as Record<string, unknown>;
    if (verb === 'list') for (const c of body.checkpoints as { id: string; seq: number; tool: string; ts: number }[])
      console.log(`${c.id.slice(0, 12)}\tseq ${c.seq}\t${c.tool}\t${new Date(c.ts).toISOString()}`);
    else if (verb === 'diff') process.stdout.write(`${String(body.patch)}${body.truncated ? '\n… patch truncated at 1 MiB\n' : ''}`);
    else console.log(JSON.stringify(body, null, 2));
    return 0;
  });
}

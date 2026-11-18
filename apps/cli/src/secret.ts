import { resolve } from 'node:path';
import { withDaemon } from './daemon.ts';
import { flag } from './usage.ts';

const USAGE = 'usage: ormi secret set <NAME> [--project p] (value on stdin) | delete <NAME> [--project p] | status <project> | list [--project p]';

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function secretCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (!verb) { console.error(USAGE); return 2; }
  if (verb === 'list') {
    const project = flag(args, '--project');
    return withDaemon(async link => {
      const res = await link.request('secret.list', project ? { project: resolve(project) } : {});
      if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
      const body = res.body as { keyring: string; available: boolean; message?: string; secrets: { name: string; scope: string; declared: boolean; missing: boolean }[] };
      console.log(`keyring: ${body.keyring}${body.available ? '' : `\n${body.message ?? 'No keyring backend is available.'}`}`);
      for (const secret of body.secrets) console.log(`${secret.name}\t${secret.scope}${secret.declared ? '\tdeclared' : ''}${secret.missing ? '\tmissing' : ''}`);
      return 0;
    });
  }
  const [name] = args;
  if (!name) { console.error(USAGE); return 2; }
  const project = flag(args, '--project');
  const scope = project ? { project: resolve(project) } : {};
  let value = '';
  if (verb === 'set') {
    if (process.stdin.isTTY) console.error(`value for ${name} (then Ctrl-D):`);
    value = await stdin();
    if (!value) { console.error('empty value'); return 2; }
  }
  return withDaemon(async link => {
    const res = verb === 'set' ? await link.request('secret.set', { name, value, ...scope })
      : verb === 'delete' ? await link.request('secret.delete', { name, ...scope })
      : verb === 'status' ? await link.request('secret.status', { project: resolve(name) })
      : undefined;
    if (!res) { console.error(USAGE); return 2; }
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    const body = res.body as { keyring?: string; declared?: string[]; missing?: string[] };
    if (verb === 'status') console.log(`keyring: ${body.keyring}\ndeclared: ${body.declared?.join(', ') || '-'}\nmissing: ${body.missing?.join(', ') || '-'}`);
    else console.log('ok');
    return 0;
  });
}

import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi file ls [path] | cat <path> | search <query> [--content] [--regex] | blame <path> | history <path> --session <id>';

export async function fileCommand(verb: string | undefined, args: string[]): Promise<number> {
  const sessionIndex = args.indexOf('--session');
  const session = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
  const positional = args.filter((arg, index) => index !== sessionIndex && index !== sessionIndex + 1 && arg !== '--content' && arg !== '--regex');
  if (!session || !verb) { console.error(USAGE); return 2; }

  let method: string;
  let body: Record<string, unknown>;
  if (verb === 'ls' && positional.length <= 1) {
    method = 'file.list';
    body = { session, ...(positional[0] ? { path: positional[0] } : {}) };
  } else if (verb === 'cat' && positional.length === 1) {
    method = 'file.read'; body = { session, path: positional[0] };
  } else if (verb === 'search' && positional.length) {
    const content = args.includes('--content');
    method = 'file.search';
    body = { session, query: positional.join(' '), mode: content ? 'content' : 'name', ...(content && args.includes('--regex') ? { regex: true } : {}) };
  } else if ((verb === 'blame' || verb === 'history') && positional.length === 1) {
    method = verb === 'blame' ? 'file.blame' : 'file.history';
    body = { session, path: positional[0] };
  } else { console.error(USAGE); return 2; }

  return withDaemon(async link => {
    const response = await link.request(method, body);
    if (response.type === 'err') { console.error(`${response.code}: ${response.message}`); return 1; }
    console.log(JSON.stringify(response.body, null, 2));
    return 0;
  });
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface BrowserLink { request(method: string, body: Record<string, unknown>): Promise<any> }

const usage = 'usage: ormi browser status | install | open <session> [port] [path] | screenshot <session> [file]';

export async function browserCommand(verb: string | undefined, args: string[]): Promise<number> {
  const { withDaemon } = await import('./daemon.ts');
  if (verb === 'status' || verb === 'install') return withDaemon(async link => {
    const result = await link.request(`browser.${verb}`, {});
    if (result.type === 'err') { console.error(`${result.code}: ${result.message}`); return 1; }
    console.log(JSON.stringify(result.body, null, 2));
    return 0;
  });
  const session = args[0];
  if (!session || (verb !== 'open' && verb !== 'screenshot')) { console.error(usage); return 2; }
  return withDaemon(link => verb === 'open' ? open(link, session, args.slice(1)) : screenshot(link, session, args.slice(1)));
}

async function open(link: BrowserLink, session: string, args: string[]): Promise<number> {
  const port = args[0] ? Number(args[0]) : undefined;
  if (args[0] && !Number.isInteger(port)) { console.error(usage); return 2; }
  const result = await link.request('browser.open', { session, ...(port ? { port } : {}), ...(args[1] ? { path: args[1] } : {}) });
  if (result.type === 'err') { console.error(`${result.code}: ${result.message}`); return 1; }
  console.log(JSON.stringify(result.body));
  return 0;
}

async function screenshot(link: BrowserLink, session: string, args: string[]): Promise<number> {
  const result = await link.request('browser.screenshot', { session });
  if (result.type === 'err') { console.error(`${result.code}: ${result.message}`); return 1; }
  const artifact = String((result.body as Record<string, unknown>).artifact ?? '');
  const file = resolve(args[0] ?? `browser-${artifact}.png`);
  const data = await link.request('browser.artifact', { session, id: artifact });
  if (data.type === 'err') { console.error(`${data.code}: ${data.message}`); return 1; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(String((data.body as Record<string, unknown>).data), 'base64'), { mode: 0o600 });
  console.log(file);
  return 0;
}

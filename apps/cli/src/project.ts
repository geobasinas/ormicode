import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi project branches <path> | ormi project fetch <path>';

export async function projectCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (!['branches', 'fetch'].includes(verb ?? '') || args.length !== 1) { console.error(USAGE); return 2; }
  return withDaemon(async link => {
    const response = await link.request(verb === 'fetch' ? 'project.fetch' : 'project.branches', { project: args[0] });
    if (response.type === 'err') {
      console.error(`${response.code}: ${response.message}`);
      return 1;
    }
    if (verb === 'fetch' && !(response.body as { ok: boolean }).ok) {
      console.error((response.body as { error?: string }).error ?? 'fetch failed');
      return 1;
    }
    console.log(JSON.stringify(response.body, null, 2));
    return 0;
  });
}

import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi project branches <path>';

export async function projectCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (verb !== 'branches' || args.length !== 1) { console.error(USAGE); return 2; }
  return withDaemon(async link => {
    const response = await link.request('project.branches', { project: args[0] });
    if (response.type === 'err') {
      console.error(`${response.code}: ${response.message}`);
      return 1;
    }
    console.log(JSON.stringify(response.body, null, 2));
    return 0;
  });
}

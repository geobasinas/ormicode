import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi project branches <path> | ormi project fetch <path> | ormi project pull <path> <branch> | ormi project rename-branch <path> <from> <to> | ormi project delete-branch <path> <name> --confirm <name> [--force]';

export async function projectCommand(verb: string | undefined, args: string[]): Promise<number> {
  const expected: Record<string, number> = { branches: 1, fetch: 1, pull: 2, 'rename-branch': 3 };
  const count = expected[verb ?? ''];
  const deleteConfirm = args[2] === '--confirm' ? args[3] : undefined;
  const validDelete = verb === 'delete-branch' && args.length >= 4 && args.length <= 5
    && Boolean(args[0] && args[1] && deleteConfirm)
    && (args.length === 4 || args[4] === '--force');
  if (count === undefined ? !validDelete : args.length !== count) { console.error(USAGE); return 2; }
  const method = verb === 'branches' ? 'project.branches'
    : verb === 'fetch' ? 'project.fetch'
      : verb === 'pull' ? 'project.pull'
        : verb === 'rename-branch' ? 'project.renameBranch' : 'project.deleteBranch';
  const body = method === 'project.pull' ? { project: args[0], branch: args[1] }
    : method === 'project.renameBranch' ? { project: args[0], from: args[1], to: args[2] }
      : method === 'project.deleteBranch' ? { project: args[0], name: args[1], confirm: deleteConfirm, ...(args[4] === '--force' ? { force: true } : {}) }
        : { project: args[0] };
  return withDaemon(async link => {
    const response = await link.request(method, body);
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

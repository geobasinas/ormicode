import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CommandResult } from './worktree-process.ts';

export function findWorkspaceHook(roots: string[], name: string): string | undefined {
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.bat'] : [''];
  for (const root of roots) for (const extension of extensions) {
    const path = join(root, '.ormi', `${name}${extension}`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function runWorkspaceHook(
  file: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, tailBytes = 8192,
): Promise<CommandResult> {
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  return run(batch ? 'cmd' : 'bash', batch ? ['/c', file] : [file], { cwd, env, timeoutMs, tailBytes });
}

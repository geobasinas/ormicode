import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';

const MAX_BUFFER = 256 * 1024 * 1024;

export class CommandError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr = '') {
    super(message);
    this.name = 'CommandError';
    this.stderr = stderr;
  }
}

export function run(command: string, cwd: string, args: string[], input?: string): string {
  try {
    return execFileSync(command, args, {
      cwd, encoding: 'utf8', input, maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { message?: string; stderr?: string | Buffer };
    const stderr = e.stderr?.toString().trim() ?? '';
    throw new CommandError(stderr || e.message || `${command} failed`, stderr);
  }
}

export const git = (cwd: string, ...args: string[]) => run('git', cwd, args);

export function isGitRepo(cwd: string): boolean {
  try {
    const directory = realpathSync(cwd);
    if (!statSync(directory).isDirectory()) return false;
    return git(directory, 'rev-parse', '--is-inside-work-tree').trim() === 'true';
  }
  catch { return false; }
}

export function currentBranch(cwd: string): string | null {
  try {
    const branch = git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').trim();
    return branch || null;
  } catch { return null; }
}

export function resolveCommit(cwd: string, ref: string): string {
  return git(cwd, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
}

export function commandMessage(error: unknown): string {
  if (error instanceof CommandError) return error.stderr || error.message;
  return error instanceof Error ? error.message : String(error);
}

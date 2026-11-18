import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface CommandResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  output: Buffer;
  error?: Error;
  timedOut: boolean;
}

function appendTail(previous: Buffer, chunk: Buffer, limit: number): Buffer {
  const joined = Buffer.concat([previous, chunk]);
  return joined.length > limit ? joined.subarray(joined.length - limit) : joined;
}

export function run(
  command: string, args: string[],
  options: { cwd: string; input?: Buffer | string; env?: NodeJS.ProcessEnv; timeoutMs?: number; tailBytes?: number },
): Promise<CommandResult> {
  return new Promise(resolveResult => {
    let child: ChildProcessWithoutNullStreams;
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const finish = (result: Omit<CommandResult, 'timedOut'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolveResult({ ...result, timedOut });
    };
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ code: null, stdout, stderr, output, error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }
    child.stdout.on('data', (chunk: Buffer) => {
      if (options.tailBytes) {
        stdout = appendTail(stdout, chunk, options.tailBytes);
        output = appendTail(output, chunk, options.tailBytes);
      } else stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (options.tailBytes) {
        stderr = appendTail(stderr, chunk, options.tailBytes);
        output = appendTail(output, chunk, options.tailBytes);
      } else stderr = Buffer.concat([stderr, chunk]);
    });
    child.on('error', error => finish({ code: null, stdout, stderr, output, error }));
    child.on('close', code => finish({ code, stdout, stderr, output }));
    child.stdin.on('error', () => {});
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
    timer = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    }, options.timeoutMs) : undefined;
    timer?.unref();
  });
}

export function commandMessage(result: CommandResult, timeoutMs?: number): string {
  if (result.timedOut) return `timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds`;
  return result.error?.message || result.stderr.toString('utf8').trim() || result.stdout.toString('utf8').trim() || `exit ${result.code ?? 'unknown'}`;
}

export async function git(project: string, ...args: string[]): Promise<string> {
  const result = await run('git', args, { cwd: project });
  if (result.code !== 0) throw new Error(commandMessage(result));
  return result.stdout.toString('utf8').trim();
}

export async function gitResult(project: string, args: string[], input?: Buffer | string, timeoutMs?: number, tailBytes?: number): Promise<CommandResult> {
  return run('git', args, { cwd: project, input, timeoutMs, tailBytes });
}

export async function maybeGit(project: string, ...args: string[]): Promise<string | undefined> {
  const result = await run('git', args, { cwd: project });
  return result.code === 0 ? result.stdout.toString('utf8').trim() : undefined;
}

export async function isRepoAsync(dir: string): Promise<boolean> {
  return await maybeGit(dir, 'rev-parse', '--is-inside-work-tree') === 'true';
}

export interface Head { branch: string | null; commit: string }
export async function headAsync(dir: string): Promise<Head> {
  const commit = await git(dir, 'rev-parse', 'HEAD');
  return { branch: await maybeGit(dir, 'symbolic-ref', '--quiet', '--short', 'HEAD') ?? null, commit };
}

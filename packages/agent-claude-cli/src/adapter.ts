import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventQueue, NO_CAPABILITIES, RawLog, attachRawLog } from '@ormicode/agent-core';
import { ClaudeSdkAdapter } from '@ormicode/agent-claude-sdk';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { monotonicFactory } from 'ulid';
import { mapCliMessage } from './map.ts';
import { PermissionBroker } from './permissions.ts';
import { startPermissionBridge } from './bridge.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
interface Session { spec: StartSpec; queue: EventQueue; log?: RawLog; nativeId?: string; process?: ChildProcessWithoutNullStreams; running?: Promise<void>; broker?: PermissionBroker; active: boolean; disposed: boolean; needsResumeId: boolean }
const newId = monotonicFactory();
const modes = new Set(['default', 'acceptEdits', 'plan', 'dontAsk']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MAX_LINE_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);
const MIN_VERSION = [2, 1, 259] as const;

export function checkClaudeVersion(output: string): { supported: boolean; version?: string; reason: string } {
  const match = /^\s*(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/.exec(output);
  if (!match) return { supported: false, reason: 'Unrecognized Claude Code version output' };
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  const version = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const comparison = parts.findIndex((part, index) => part !== MIN_VERSION[index]);
  const supported = comparison === -1 || parts[comparison]! > MIN_VERSION[comparison]!;
  return { supported, version, reason: supported ? 'CLI detected; authentication not checked' : 'Claude Code 2.1.259 or newer is required for unattended permissions' };
}

/** Print-mode CLI adapter. Write and shell prompts are forwarded to the session owner unless the bridge is explicitly disabled. */
export class ClaudeCliAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly transport = 'cli' as const;
  readonly capabilities: AgentAdapter['capabilities'];
  private readonly sessions = new Map<Handle, Session>();
  private readonly options: { executable?: string; spawn?: Spawn; readVersion?: () => Promise<string>; approvalBridge: boolean; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; readVersion?: () => Promise<string>; approvalBridge?: boolean; onNativeId?: (handle: Handle, id: string) => void } = {}) {
    this.options = { ...options, approvalBridge: options.approvalBridge !== false };
    // `dontAsk` and `--permission-prompts none` auto-deny anything that would prompt. Interactive sessions ask instead.
    this.capabilities = { ...NO_CAPABILITIES, resume: true, approvals: this.options.approvalBridge };
  }
  async detect() {
    try {
      const stdout = this.options.readVersion ? await this.options.readVersion() : (await execFileAsync(this.options.executable ?? 'claude', ['--version'], { timeout: 5000, maxBuffer: 4096, windowsHide: true, shell: false })).stdout;
      const result = checkClaudeVersion(stdout);
      return { available: result.supported, ...(result.version ? { version: result.version } : {}), reason: result.reason };
    } catch {
      return { available: false, reason: 'Claude CLI not found or version check failed; authentication not checked' };
    }
  }
  private modelProbe?: ClaudeSdkAdapter;
  async models() {
    // The CLI takes the same --model values the SDK enumerates via supportedModels().
    this.modelProbe ??= new ClaudeSdkAdapter();
    return this.modelProbe.models();
  }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> { if (!ref.id) throw new Error('native session ID is required'); return this.create({ ...ref }, ref.id); }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode && !modes.has(spec.mode)) throw new Error('Unsupported or unsafe Claude permission mode');
    if (spec.effort && !efforts.has(spec.effort)) throw new Error('Unsupported Claude effort');
    const handle = Object.freeze({ id: `claude-cli-${newId()}` });
    this.sessions.set(handle, { spec: { ...spec }, nativeId, log: spec.logDir ? new RawLog(spec.logDir) : undefined, queue: new EventQueue(), active: false, disposed: false, needsResumeId: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Claude session already has an active turn');
    if (session.needsResumeId) throw new Error('Cannot continue: session needs explicit recovery; native session ID may be missing or inconsistent');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true;
    session.running = this.run(handle, session, input.text);
  }
  private async run(handle: Handle, session: Session, prompt: string): Promise<void> {
    let resultStatus: 'success' | 'error' | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    let bridge: Awaited<ReturnType<typeof startPermissionBridge>> | undefined;
    try {
      const mode = session.spec.mode ?? 'default';
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', this.options.approvalBridge ? 'host' : 'none', '--permission-mode', mode];
      const mcpServers: Record<string, unknown> = {};
      if (session.spec.mcpServers)
        for (const [name, s] of Object.entries(session.spec.mcpServers))
          mcpServers[name] = { type: 'stdio', command: s.command, args: s.args ?? [], env: s.env ?? {} };
      let promptTool = '';
      if (this.options.approvalBridge) {
        session.broker = new PermissionBroker((event) => session.queue.push([event]));
        bridge = await startPermissionBridge(session.broker);
        if (session.disposed) return;
        const serverName = `ormicode_${newId().toLowerCase()}`;
        mcpServers[serverName] = { type: 'http', url: bridge.url, headers: { Authorization: 'Bearer ${ORMICODE_CLI_APPROVAL_TOKEN}' } };
        promptTool = `mcp__${serverName}__approve`;
      }
      if (Object.keys(mcpServers).length) {
        args.push('--mcp-config', JSON.stringify({ mcpServers }));
        if (promptTool) args.push('--permission-prompt-tool', promptTool);
      }
      if (session.spec.model) args.push('--model', session.spec.model);
      if (session.spec.effort) args.push('--effort', session.spec.effort);
      if (session.nativeId) args.push('--resume', session.nativeId);
      child = (this.options.spawn ?? spawn)(this.options.executable ?? 'claude', args, { cwd: session.spec.cwd, windowsHide: true, shell: false, ...(bridge ? { env: { ...process.env, ORMICODE_CLI_APPROVAL_TOKEN: bridge.token } } : {}) });
      session.process = child;
      let spawnError: Error | undefined;
      const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child!.once('error', (error) => { spawnError = error; });
        child!.once('close', (code, signal) => resolve({ code, signal }));
      });
      // stderr may contain credentials or prompt content; drain it without forwarding it.
      attachRawLog(child, session.log, this.options.executable ?? 'claude', session.spec.cwd);
      if (!session.log) child.stderr.resume();
      let inputError: Error | undefined;
      child.stdin.on('error', (error) => { inputError = error; });
      child.stdin.end(prompt);
      let buffer = Buffer.alloc(0);
      let reportedModel: string | undefined;
      const accept = (line: Buffer) => {
        if (!line.length || (line.length === 1 && line[0] === 13)) return;
        if (line.length > MAX_LINE_BYTES) throw new Error('Claude CLI message exceeded size limit');
        const mapped = mapCliMessage(JSON.parse(line.toString('utf8')), { model: reportedModel });
        reportedModel = mapped.model ?? reportedModel;
        if (mapped.nativeId) {
          if (session.nativeId && session.nativeId !== mapped.nativeId) {
            session.needsResumeId = true;
            throw new Error('Claude CLI returned a different native session ID');
          }
          this.options.onNativeId?.(handle, mapped.nativeId);
          session.nativeId = mapped.nativeId;
        }
        if (mapped.result) resultStatus = mapped.result;
        if (mapped.events.length) session.queue.push(mapped.events);
      };
      for await (const chunk of child.stdout) {
        session.log?.out(chunk);
        if (session.disposed) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) { accept(buffer.subarray(0, newline)); buffer = buffer.subarray(newline + 1); }
        if (buffer.length > MAX_LINE_BYTES) throw new Error('Claude CLI message exceeded size limit');
      }
      if (buffer.length && !session.disposed) accept(buffer);
      const status = await exit;
      if (spawnError) throw spawnError;
      if (inputError) throw new Error('Could not send the complete prompt to Claude CLI', { cause: inputError });
      if (!session.disposed && (!resultStatus || status.code === null || (status.code !== 0 && resultStatus !== 'error'))) {
        resultStatus = undefined;
        session.needsResumeId = true;
        session.queue.push([{ kind: 'interrupted', reason: status.code === 0 ? 'cli_stream_ended' : 'cli_exit' }, ...(status.code === 0 ? [] : [{ kind: 'error' as const, code: 'unknown', message: `Claude CLI exited with code ${status.code ?? 'unknown'}${status.signal ? ` (${status.signal})` : ''}` }])]);
      }
    } catch (error) {
      resultStatus = undefined;
      session.needsResumeId = true;
      child?.kill();
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'interrupted', reason: 'cli_error' }, { kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'Claude CLI failed' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      // The turn is idle before bridge teardown so a follow-up prompt is not stuck behind cleanup.
      const closing = bridge;
      session.broker = undefined;
      session.process = undefined; session.active = false;
      if (!session.nativeId) session.needsResumeId = true;
      if (closing) {
        try { await closing.close(); }
        catch {
          resultStatus = undefined;
          session.needsResumeId = true;
          if (!session.disposed) {
            try { session.queue.push([{ kind: 'interrupted', reason: 'approval_bridge_cleanup_failed' }, { kind: 'error', code: 'unknown', message: 'Could not close the approval bridge' }]); }
            catch { session.queue.close(); }
          }
        }
      }
      if (resultStatus && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> {
    const broker = this.get(handle).broker;
    if (!broker) throw new Error('CLI approval bridge is not active');
    broker.decide(requestId, optionId);
  }
  async answerQuestion(handle: Handle, requestId: string, answers: Record<string, string>): Promise<void> {
    const broker = this.get(handle).broker;
    if (!broker) throw new Error('CLI approval bridge is not active');
    broker.answer(requestId, answers);
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.idle(handle);
    if (!model.trim()) throw new Error('Model is required');
    session.queue.push([{ kind: 'model_changed', model, effective: 'next_turn' }]);
    session.spec.model = model;
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.idle(handle);
    if (!efforts.has(effort)) throw new Error('Unsupported Claude effort');
    session.queue.push([{ kind: 'effort_changed', effort, effective: 'next_turn' }]);
    session.spec.effort = effort;
  }
  async setMode(handle: Handle, mode: string): Promise<void> {
    const session = this.idle(handle);
    if (!modes.has(mode)) throw new Error('Unsupported or unsafe Claude permission mode');
    session.queue.push([{ kind: 'mode_changed', mode, effective: 'next_turn' }]);
    session.spec.mode = mode;
  }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle);
    if (!session) return;
    session.disposed = true;
    session.broker?.dispose();
    session.process?.kill();
    await session.running;
    session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed Claude session');
    return session;
  }
  private idle(handle: Handle): Session {
    const session = this.get(handle);
    if (session.active) throw new Error('Claude session already has an active turn');
    return session;
  }
}

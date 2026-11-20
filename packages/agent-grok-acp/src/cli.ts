import { GrokAcpAdapter } from './adapter.ts';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';

/** The Grok CLI's agent stdio mode provides bidirectional permissions; headless dontAsk cannot. */
export class GrokInteractiveCliAdapter implements AgentAdapter {
  readonly id = 'grok';
  readonly transport = 'cli' as const;
  private readonly agent: GrokAcpAdapter;
  constructor(options: ConstructorParameters<typeof GrokAcpAdapter>[0] = {}) { this.agent = new GrokAcpAdapter(options); }
  get capabilities() { return this.agent.capabilities; }
  detect() { return this.agent.detect(); }
  models() { return this.agent.models(); }
  start(spec: StartSpec) { return this.agent.start(spec); }
  resume(ref: NativeRef) { return this.agent.resume(ref); }
  prompt(handle: Handle, input: PromptInput) { return this.agent.prompt(handle, input); }
  approve(handle: Handle, request: string, option: string) { return this.agent.approve(handle, request, option); }
  interrupt(handle: Handle) { return this.agent.interrupt(handle); }
  setModel(handle: Handle, model: string) { return this.agent.setModel(handle, model); }
  setEffort(handle: Handle, effort: string) { return this.agent.setEffort(handle, effort); }
  setOption(handle: Handle, id: string, value: string | boolean) { return this.agent.setOption(handle, id, value); }
  events(handle: Handle) { return this.agent.events(handle); }
  dispose(handle: Handle) { return this.agent.dispose(handle); }
}

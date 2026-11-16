import type { AgentEvent } from '@ormicode/protocol';

type Result = IteratorResult<AgentEvent>;
const done = (): Result => ({ done: true, value: undefined });

/** Single-consumer bounded queue; returning an iterator wakes pending reads. */
export class EventQueue {
  private items: AgentEvent[] = [];
  private pending: ((result: Result) => void) | undefined;
  private closed = false;
  private active = false;

  push(events: readonly AgentEvent[]): void {
    if (this.closed) throw new Error('event queue is closed');
    if (this.items.length + events.length > 1024) throw new Error('fake event buffer is full');
    this.items.push(...events);
    this.flush();
  }
  close(): void { this.closed = true; this.flush(); }
  subscribe(): AsyncIterableIterator<AgentEvent> {
    if (this.active) throw new Error('fake session already has a consumer');
    this.active = true;
    let finished = false;
    return {
      [Symbol.asyncIterator]() { return this; },
      next: () => {
        if (finished) return Promise.resolve(done());
        if (this.pending) return Promise.reject(new Error('concurrent reads are not supported'));
        const item = this.items.shift();
        if (item) return Promise.resolve({ done: false, value: item });
        if (this.closed) { finished = true; this.active = false; return Promise.resolve(done()); }
        return new Promise<Result>((resolve) => { this.pending = resolve; });
      },
      return: () => {
        if (finished) return Promise.resolve(done());
        finished = true;
        this.active = false;
        const pending = this.pending;
        this.pending = undefined;
        pending?.(done());
        return Promise.resolve(done());
      },
    };
  }
  private flush(): void {
    if (!this.pending) return;
    const item = this.items.shift();
    if (item) {
      const resolve = this.pending;
      this.pending = undefined;
      resolve({ done: false, value: item });
    } else if (this.closed) {
      const resolve = this.pending;
      this.pending = undefined;
      this.active = false;
      resolve(done());
    }
  }
}

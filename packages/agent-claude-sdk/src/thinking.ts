import type { AgentEvent } from '@ormicode/protocol';

export class ThinkingCapture {
  private text = '';

  accept(events: AgentEvent[]): AgentEvent[] {
    const result: AgentEvent[] = [];
    for (const event of events) {
      if (event.kind === 'thinking_delta') this.text += event.text;
      if (event.kind === 'thinking') {
        const text = event.text || this.text;
        this.text = '';
        if (text) result.push({ ...event, text });
        continue;
      }
      if (event.kind === 'turn_end' || event.kind === 'interrupted') result.push(...this.flush());
      result.push(event);
    }
    return result;
  }

  flush(): AgentEvent[] {
    const text = this.text;
    this.text = '';
    return text ? [{ kind: 'thinking', text }] : [];
  }
}

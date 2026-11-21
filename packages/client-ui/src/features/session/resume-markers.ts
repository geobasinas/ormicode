/** Kinds the transcript never draws; they must not separate resume markers. */
const hiddenKinds = new Set(['evicted', 'usage', 'state', 'agent_version', 'turn_start', 'turn_end', 'tool_result', 'checkpoint_screenshot', 'terminal_open', 'terminal_close']);

/** Drops a `resumed` marker when the last visible event before it is already one. */
export function collapseResumeMarkers<T extends { kind: string }>(events: T[]): T[] {
  let lastVisible: string | undefined;
  return events.filter(event => {
    if (hiddenKinds.has(event.kind)) return true;
    const repeat = event.kind === 'resumed' && lastVisible === 'resumed';
    lastVisible = event.kind;
    return !repeat;
  });
}

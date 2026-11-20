export function collapseResumeMarkers<T extends { kind: string }>(events: T[]): T[] {
  return events.filter((event, index) => event.kind !== 'resumed' || events[index - 1]?.kind !== 'resumed');
}

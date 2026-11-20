const positions = new Map<string, { top: number; following: boolean }>();

export function saveTranscriptPosition(session: string, top: number, following: boolean): void {
  positions.delete(session);
  positions.set(session, { top: Math.max(0, top), following });
  if (positions.size > 100) positions.delete(positions.keys().next().value!);
}

export function transcriptPosition(session: string) { return positions.get(session); }

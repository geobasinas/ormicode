import { realpathSync } from 'node:fs';
import { listSessions } from '@ormicode/session-store';
import { DESIGN_ACTIVITY_LIMIT, type DesignActivityItem } from '@ormicode/protocol';
import type { DispatchCtx } from './dispatch.ts';

export function worktreeDesignSessions(db: DispatchCtx['db'], root: string) {
  return [...listSessions(db), ...listSessions(db, true)].filter(row => {
    try { return realpathSync(row.cwd) === root; } catch { return false; }
  });
}

export function recentDesignEdits(db: DispatchCtx['db'], root: string, slug: string): DesignActivityItem[] {
  const query = db.prepare(`SELECT ts, payload FROM events
    WHERE session = ? AND kind = 'design_changed' AND json_valid(payload) AND json_extract(payload, '$.slug') = ?
    ORDER BY seq DESC LIMIT ?`);
  const edits = new Map<number, DesignActivityItem>();
  for (const { id } of worktreeDesignSessions(db, root)) {
    for (const { ts, payload } of query.all(id, slug, DESIGN_ACTIVITY_LIMIT) as { ts: number; payload: string }[]) {
      const { revision, originSession, source, summary } = JSON.parse(payload) as Omit<DesignActivityItem, 'at'>;
      const existing = edits.get(revision);
      if (!existing || ts < existing.at) edits.set(revision, { revision, originSession, source, summary, at: ts });
    }
  }
  return [...edits.values()].sort((a, b) => b.revision - a.revision).slice(0, DESIGN_ACTIVITY_LIMIT);
}

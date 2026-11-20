import type { Store } from '@ormicode/session-store';

export function promptHistory(db: Store, options: { project?: string; query?: string; limit?: number }) {
  const query = (options.query ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const rows = db.prepare(`
    SELECT e.payload, e.ts, e.session, s.project FROM events e
    JOIN sessions s ON s.id = e.session
    WHERE e.kind = 'prompt' AND s.kind = 'session' ${options.project ? 'AND s.project = ?' : ''}
    ORDER BY e.ts DESC, e.seq DESC, e.session
    LIMIT 1000
  `).all(...(options.project ? [options.project] : [])) as { payload: string; ts: number; session: string; project: string }[];
  const seen = new Set<string>();
  const items: { text: string; createdAt: number; session: string; project: string }[] = [];
  for (const row of rows) {
    let payload: { text?: unknown };
    try { payload = JSON.parse(row.payload); } catch { continue; }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text || !text.toLowerCase().includes(query) || seen.has(text)) continue;
    seen.add(text);
    items.push({ text, createdAt: row.ts, session: row.session, project: row.project });
    if (items.length === limit) break;
  }
  return items;
}

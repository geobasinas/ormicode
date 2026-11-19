import type { Store, SessionRow } from '@ormicode/session-store';

export function sessionTeamView(db: Store, session: SessionRow) {
  const usage = db.prepare(`WITH RECURSIVE roster(id) AS (SELECT ? UNION SELECT s.id FROM sessions s
    JOIN roster r ON s.parent = r.id WHERE s.team IS NOT NULL), usage AS (
    SELECT session, COALESCE(SUM(COALESCE(json_extract(payload, '$.input'), 0)
    + COALESCE(json_extract(payload, '$.output'), 0) + COALESCE(json_extract(payload, '$.cacheRead'), 0)
    + COALESCE(json_extract(payload, '$.cacheWrite'), 0)), 0) AS tokens
    FROM events WHERE session IN (SELECT id FROM roster) AND kind = 'usage' GROUP BY session)
    SELECT COALESCE((SELECT tokens FROM usage WHERE session = ?), 0) AS tokens,
    COALESCE(SUM(tokens), 0) AS teamTokens FROM usage`).get(session.id, session.id) as { tokens: number; teamTokens: number };
  return { parent: session.parent, team: session.team, tokens: usage.tokens, teamTokens: usage.teamTokens };
}

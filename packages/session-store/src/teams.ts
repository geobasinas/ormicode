import type { Store } from './db.ts';
import type { SessionRow } from './sessions.ts';

export interface TeamRow { id: string; parent: string; project: string; created_at: number; closed_at: number | null }
export interface TeamMessage {
  id: string; team: string; from_session: string; to_session: string; reply_to: string | null;
  body: string; urgent: number; created_at: number; read_at: number | null;
}
export function getTeam(db: Store, id: string): TeamRow | undefined {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined;
}
export function ownedTeam(db: Store, parent: string): TeamRow | undefined {
  return db.prepare('SELECT * FROM teams WHERE parent = ? AND closed_at IS NULL').get(parent) as TeamRow | undefined;
}
export function createTeam(db: Store, team: { id: string; parent: string; project: string }): void {
  db.prepare('INSERT INTO teams(id, parent, project, created_at) VALUES (?, ?, ?, ?)')
    .run(team.id, team.parent, team.project, Date.now());
}
export function closeTeam(db: Store, id: string): void {
  db.prepare('UPDATE teams SET closed_at = ? WHERE id = ?').run(Date.now(), id);
}
export function activeTeamCount(db: Store): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM teams WHERE closed_at IS NULL
    AND EXISTS (SELECT 1 FROM sessions WHERE archived = 0 AND (team = teams.id OR id = teams.parent))`).get() as { n: number }).n;
}
export function teamChildren(db: Store, team: string): SessionRow[] {
  return db.prepare('SELECT * FROM sessions WHERE team = ? AND id != (SELECT parent FROM teams WHERE id = ?) ORDER BY created_at, id').all(team, team) as SessionRow[];
}
export function setSessionTeam(db: Store, session: string, team: string): void {
  db.prepare('UPDATE sessions SET team = ? WHERE id = ?').run(team, session);
}
export function addTeamMessage(db: Store, message: Omit<TeamMessage, 'read_at'>): void {
  db.prepare(`INSERT INTO team_messages(id, team, from_session, to_session, reply_to, body, urgent, created_at)
    VALUES (@id, @team, @from_session, @to_session, @reply_to, @body, @urgent, @created_at)`).run(message);
}
export function getTeamMessage(db: Store, id: string): TeamMessage | undefined {
  return db.prepare('SELECT * FROM team_messages WHERE id = ?').get(id) as TeamMessage | undefined;
}
export function unreadTeamMessages(db: Store, session: string): TeamMessage[] {
  return db.prepare('SELECT * FROM team_messages WHERE to_session = ? AND read_at IS NULL ORDER BY created_at, id')
    .all(session) as TeamMessage[];
}
export function markTeamMessagesRead(db: Store, ids: string[]): void {
  const update = db.prepare('UPDATE team_messages SET read_at = ? WHERE id = ? AND read_at IS NULL');
  db.transaction(() => { for (const id of ids) update.run(Date.now(), id); })();
}
export function settingValue(db: Store, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

export function setChildrenParentless(db: Store, parent: string, parentless: boolean): string[] {
  const rows = db.prepare(`UPDATE sessions SET parentless = ?, updated_at = ? WHERE parent = ? AND archived = 0
    AND team IN (SELECT id FROM teams WHERE parent = ? AND closed_at IS NULL)
    AND parentless != ? RETURNING id`).all(Number(parentless), Date.now(), parent, parent, Number(parentless)) as { id: string }[];
  return rows.map(row => row.id);
}
export function addTeamUserMessage(db: Store, request: string, message: string): void {
  db.transaction(() => {
    db.prepare('INSERT INTO team_user_messages(request, message) VALUES (?, ?)').run(request, message);
    markTeamMessagesRead(db, [message]);
  })();
}
export function getTeamUserMessage(db: Store, session: string, request: string): { message: string; answered_at: number | null } | undefined {
  return db.prepare(`SELECT u.message, u.answered_at FROM team_user_messages u JOIN team_messages m ON m.id = u.message
    WHERE m.from_session = ? AND u.request = ?`).get(session, request) as { message: string; answered_at: number | null } | undefined;
}
export function answerTeamUserMessage(db: Store, request: string): void {
  db.prepare('UPDATE team_user_messages SET answered_at = ? WHERE request = ?').run(Date.now(), request);
}
export function hasTeamUserMessages(db: Store, session: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM team_user_messages u JOIN team_messages m ON m.id = u.message
    WHERE m.from_session = ? AND u.answered_at IS NULL LIMIT 1`).get(session));
}

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
  return (db.prepare('SELECT COUNT(*) AS n FROM teams WHERE closed_at IS NULL').get() as { n: number }).n;
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

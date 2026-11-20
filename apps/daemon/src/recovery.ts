import { addQueuedPrompt, getTeam, listQueuedPrompts, listSessions, ownedTeam, setState, setWorkerPid, type Store, type SessionRow } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { handoffBrief } from './handoff.ts';
import { append, checkTail } from '@ormicode/journal';
import { killTreePid } from './proctree.ts';
import { resumable } from './registry.ts';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ormicodeDir } from './socket.ts';
import { expireHandoffQuestions } from './handoff-questions.ts';

/** Raw session logs are kept 7 days; called once at boot. */
export function sweepLogs(root = join(ormicodeDir(), 'logs', 'sessions'), maxAgeMs = 7 * 24 * 3600 * 1000): number {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return 0; }
  for (const entry of entries) {
    const dir = join(root, entry);
    try {
      if (statSync(dir).mtimeMs < cutoff) { rmSync(dir, { recursive: true, force: true }); removed++; }
    } catch { /* best effort */ }
  }
  return removed;
}

export type ResumePolicy = 'wait' | 'safe' | 'all';
export const resumePolicy = (): ResumePolicy => {
  const p = process.env.ORMICODE_RESUME_POLICY;
  return p === 'wait' || p === 'all' ? p : 'safe';
};

const inFlight = ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'];

/** Expire the last unanswered approval/question so clients can clear it. */
function expirePending(db: Store, session: string): void {
  const row = db.prepare(
    "SELECT kind, payload FROM events WHERE session = ? AND kind IN ('approval_request','question_request') ORDER BY seq DESC LIMIT 1",
  ).get(session) as { kind: string; payload: string } | undefined;
  const payload = row ? JSON.parse(row.payload) as Record<string, unknown> : {};
  append(db, session, { kind: 'interaction_expired', payload: { kind: 'interaction_expired', reason: 'host_restart', request: payload.request ?? payload.id, answerable: row?.kind === 'question_request' && payload.daemonInteraction === true, ...(payload.id ? { id: payload.id } : {}) } });
}

/**
 * Boot recovery: leases are dropped, torn tails repaired, every in-flight
 * session is interrupted with host_restart (pending interactions expired
 * first), and stale worker pids are reaped. Returns the sessions the resume
 * policy allows auto-resuming — 'safe' resumes completed sessions with native
 * resume support, 'all' also retries interrupted ones, 'wait' resumes nothing.
 */
export interface ResumeCandidate { s: SessionRow; recapOnly: boolean }
export interface Recovery { autoResume: ResumeCandidate[]; rateLimited: { id: string; resetAt: number }[] }

export function recoverSessions(db: Store, policy: ResumePolicy): Recovery {
  db.exec('DELETE FROM leases');
  for (const s of listSessions(db).filter(s => s.handed_off))
    expireHandoffQuestions({ db, record: (session, kind, payload) => { append(db, session, { kind, payload }); } }, s.id);
  for (const s of listSessions(db).filter(s => !s.handed_off && [...inFlight, 'interrupted'].includes(s.state))) {
    checkTail(db, s.id);
    const team = s.team ? getTeam(db, s.team) : undefined;
    if (team && team.parent !== s.id && team.closed_at === null && ['starting', 'running', 'retrying'].includes(s.state)
      && !listQueuedPrompts(db, s.id).length)
      addQueuedPrompt(db, s.id, { id: newId('q'), text: `Resume your interrupted team task. Review this recap before continuing:\n${handoffBrief(db, s.id)}`, createdAt: Date.now() });
    // paused_rate_limited sessions keep their schedule: the timer is re-armed
    // from the last error event's resetAt instead of interrupting the session.
    if (inFlight.includes(s.state) && s.state !== 'paused_rate_limited') {
      if (s.state === 'awaiting_approval' || s.state === 'awaiting_input') expirePending(db, s.id);
      append(db, s.id, { kind: 'interrupted', payload: { reason: 'host_restart' } });
      setState(db, s.id, 'interrupted', 'host_restart');
    }
    if (s.worker_pid) { try { process.kill(s.worker_pid, 0); killTreePid(s.worker_pid); } catch { /* gone */ } setWorkerPid(db, s.id, null); }
  }
  const rateLimited = listSessions(db).filter(s => !s.handed_off && s.state === 'paused_rate_limited').flatMap(s => {
    const row = db.prepare("SELECT payload FROM events WHERE session = ? AND kind = 'error' ORDER BY seq DESC LIMIT 1").get(s.id) as { payload: string } | undefined;
    const resetAt = row ? (JSON.parse(row.payload) as { resetAt?: number }).resetAt : undefined;
    return typeof resetAt === 'number' ? [{ id: s.id, resetAt }] : [];
  });
  if (policy === 'wait') return { autoResume: [], rateLimited };
  const states = policy === 'all' ? ['idle', 'done', 'interrupted'] : ['idle', 'done'];
  // 'all' also picks sessions with no usable native resume; those respawn fresh
  // and get a journaled handoff_brief recap instead of their transcript.
  const autoResume = listSessions(db)
    .filter(s => {
      if (s.handed_off) return false;
      const team = s.team ? getTeam(db, s.team) : undefined;
      if (team && team.parent !== s.id) return false;
      if (ownedTeam(db, s.id)?.closed_at === null && (['idle', 'done'].includes(s.state) || s.state === 'interrupted' && s.reason === 'host_restart')) return true;
      return policy === 'all' ? states.includes(s.state) : s.native_id && states.includes(s.state) && resumable(s.vendor, s.transport);
    })
    .map(s => ({ s, recapOnly: !(s.native_id && resumable(s.vendor, s.transport)) }));
  return { autoResume, rateLimited };
}

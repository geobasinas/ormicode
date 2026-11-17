import { listSessions, setState, setWorkerPid, type Store, type SessionRow } from '@ormicode/session-store';
import { append, checkTail } from '@ormicode/journal';
import { killTreePid } from './proctree.ts';
import { resumable } from './registry.ts';

export type ResumePolicy = 'wait' | 'safe' | 'all';
export const resumePolicy = (): ResumePolicy => {
  const p = process.env.ORMICODE_RESUME_POLICY;
  return p === 'wait' || p === 'all' ? p : 'safe';
};

const inFlight = ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'];

/** Expire the last unanswered approval/question so clients can clear it. */
function expirePending(db: Store, session: string): void {
  const row = db.prepare(
    "SELECT payload FROM events WHERE session = ? AND kind IN ('approval_request','question_request') ORDER BY seq DESC LIMIT 1",
  ).get(session) as { payload: string } | undefined;
  const id = row ? (JSON.parse(row.payload) as Record<string, unknown>).id : undefined;
  append(db, session, { kind: 'interaction_expired', payload: { kind: 'interaction_expired', ...(id ? { id } : {}) } });
}

/**
 * Boot recovery: leases are dropped, torn tails repaired, every in-flight
 * session is interrupted with host_restart (pending interactions expired
 * first), and stale worker pids are reaped. Returns the sessions the resume
 * policy allows auto-resuming — 'safe' resumes completed sessions with native
 * resume support, 'all' also retries interrupted ones, 'wait' resumes nothing.
 */
export interface Recovery { autoResume: SessionRow[]; rateLimited: { id: string; resetAt: number }[] }

export function recoverSessions(db: Store, policy: ResumePolicy): Recovery {
  db.exec('DELETE FROM leases');
  for (const s of listSessions(db).filter(s => [...inFlight, 'interrupted'].includes(s.state))) {
    checkTail(db, s.id);
    // paused_rate_limited sessions keep their schedule: the timer is re-armed
    // from the last error event's resetAt instead of interrupting the session.
    if (inFlight.includes(s.state) && s.state !== 'paused_rate_limited') {
      if (s.state === 'awaiting_approval' || s.state === 'awaiting_input') expirePending(db, s.id);
      append(db, s.id, { kind: 'interrupted', payload: { reason: 'host_restart' } });
      setState(db, s.id, 'interrupted', 'host_restart');
    }
    if (s.worker_pid) { try { process.kill(s.worker_pid, 0); killTreePid(s.worker_pid); } catch { /* gone */ } setWorkerPid(db, s.id, null); }
  }
  const rateLimited = listSessions(db).filter(s => s.state === 'paused_rate_limited').flatMap(s => {
    const row = db.prepare("SELECT payload FROM events WHERE session = ? AND kind = 'error' ORDER BY seq DESC LIMIT 1").get(s.id) as { payload: string } | undefined;
    const resetAt = row ? (JSON.parse(row.payload) as { resetAt?: number }).resetAt : undefined;
    return typeof resetAt === 'number' ? [{ id: s.id, resetAt }] : [];
  });
  if (policy === 'wait') return { autoResume: [], rateLimited };
  const states = policy === 'all' ? ['idle', 'done', 'interrupted'] : ['idle', 'done'];
  const autoResume = listSessions(db).filter(s =>
    s.native_id && states.includes(s.state) && resumable(s.vendor, s.transport));
  return { autoResume, rateLimited };
}

import { getSession, setState, type Store } from '@ormicode/session-store';

export function rateRetries(db: Store, retry: (session: string) => Promise<boolean> | undefined) {
  const timers = new Map<string, NodeJS.Timeout>();
  const cancel = (session: string) => { clearTimeout(timers.get(session)); timers.delete(session); };
  return {
    cancel,
    schedule(session: string, resetAt: number) {
      cancel(session);
      timers.set(session, setTimeout(() => {
        timers.delete(session);
        if (getSession(db, session)?.state === 'paused_rate_limited')
          void retry(session)?.then(ok => { if (!ok) setState(db, session, 'interrupted', 'resume_failed'); });
      }, Math.max(0, resetAt - Date.now())).unref());
    },
    close() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}

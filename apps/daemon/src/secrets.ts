// Secret broker: resolves a project's declared secrets from the keyring at
// worker spawn, keeps them in memory only, and redacts them from events.
import { systemKeyring, resolve, Redactor, audit, type Keyring } from '@ormicode/secrets';

export class SecretBroker {
  readonly keyring: Keyring;
  private readonly auditPath: string;
  private readonly redactors = new Map<string, Redactor>();
  constructor(auditPath: string, keyring: Keyring = systemKeyring()) { this.auditPath = auditPath; this.keyring = keyring; }

  missing(project: string): string[] { return resolve(this.keyring, project).missing; }

  envFor(session: string, project: string): Record<string, string> {
    const { env } = resolve(this.keyring, project);
    this.redactors.set(session, new Redactor(env));
    for (const name of Object.keys(env)) audit(this.auditPath, { session, name, action: 'inject' });
    return env;
  }

  /** Returns the redacted payload; a leaked value is logged and flagged on the payload. */
  redact(session: string, payload: Record<string, unknown>): Record<string, unknown> {
    const r = this.redactors.get(session);
    if (!r || r.empty) return payload;
    const hits = new Set<string>();
    const out = r.deep(payload, hits);
    for (const name of hits) audit(this.auditPath, { session, name, action: 'leak' });
    return hits.size ? { ...out, redacted: [...hits] } : out;
  }

  forget(session: string): void { this.redactors.delete(session); }
  log(name: string, action: 'set' | 'delete'): void { audit(this.auditPath, { name, action }); }
}

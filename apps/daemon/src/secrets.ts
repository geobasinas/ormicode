// Secret broker: resolves a project's declared secrets from the keyring at
// worker spawn, keeps them in memory only, and redacts them from events.
import { systemKeyring, resolve, declared, account, readNamesIndex, updateNamesIndex, Redactor, audit, type Keyring } from '@ormicode/secrets';

export class SecretBroker {
  readonly keyring: Keyring;
  private readonly auditPath: string;
  private readonly namesPath: string;
  private readonly redactors = new Map<string, Redactor>();
  constructor(auditPath: string, namesPath: string, keyring: Keyring = systemKeyring()) {
    this.auditPath = auditPath; this.namesPath = namesPath; this.keyring = keyring;
  }

  missing(project: string): string[] { return resolve(this.keyring, project).missing; }

  names(project?: string): {
    keyring: string; available: boolean; secrets: { name: string; scope: 'project' | 'machine'; declared: boolean; missing: boolean }[];
    message?: string;
  } {
    const index = readNamesIndex(this.namesPath);
    const declarations = project ? declared(project) : [];
    const declaredNames = new Set(declarations);
    const projectNames = new Set(project ? index.projects[project] ?? [] : []);
    const names = new Set([...index.machine, ...projectNames, ...declarations]);
    const missing = new Set(project ? this.missing(project) : []);
    const secrets = [...names].sort().map(name => ({
      name, scope: project && (projectNames.has(name) || declaredNames.has(name)) ? 'project' as const : 'machine' as const,
      declared: declaredNames.has(name), missing: declaredNames.has(name) && missing.has(name),
    }));
    return {
      keyring: this.keyring.kind, available: this.keyring.kind !== 'none', secrets,
      ...(this.keyring.message ? { message: this.keyring.message } : {}),
    };
  }

  indexName(name: string, project: string | undefined, add: boolean): void {
    updateNamesIndex(this.namesPath, name, project, add);
  }

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

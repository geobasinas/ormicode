// Replaces loaded secret values with [redacted:NAME] in strings and nested JSON.
export class Redactor {
  private readonly pairs: [string, string][];
  constructor(env: Record<string, string>) {
    // Longest first so a value containing another is replaced whole; very short values would redact noise.
    this.pairs = Object.entries(env).filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [v, k]);
  }
  get empty(): boolean { return this.pairs.length === 0; }
  text(s: string, hits?: Set<string>): string {
    let out = s;
    for (const [value, name] of this.pairs) if (out.includes(value)) { out = out.split(value).join(`[redacted:${name}]`); hits?.add(name); }
    return out;
  }
  deep<T>(v: T, hits?: Set<string>): T {
    if (this.empty) return v;
    if (typeof v === 'string') return this.text(v, hits) as T;
    if (Array.isArray(v)) return v.map(x => this.deep(x, hits)) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.deep(x, hits)])) as T;
    return v;
  }
}

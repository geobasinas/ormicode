/**
 * Pairing on the hub: mint one-shot 12-digit codes, verify them with an
 * attempt budget, and issue device tokens (raw token shown once, SHA-256
 * stored). The relay is pushed the code hash and later the device hash so it
 * can route joins and accept connections.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomCode, randomToken, sha256hex, normalizeCode } from '@ormicode/crypto';
import { newId } from '@ormicode/protocol';
import { addDevice, type Store } from '@ormicode/session-store';
import { ormicodeDir } from './socket.ts';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;

export interface HubConfig { account: string; token: string; relayUrl: string }

/** Hub identity lives in ~/.ormicode/hub.json (0600): account, token, relay URL. */
export function loadHubConfig(): HubConfig | undefined {
  try {
    const path = join(ormicodeDir(), 'hub.json');
    if (!existsSync(path)) return undefined;
    const c = JSON.parse(readFileSync(path, 'utf8')) as HubConfig;
    return c.account && c.token && c.relayUrl ? c : undefined;
  } catch { return undefined; }
}

export function saveHubConfig(c: HubConfig): void {
  const path = join(ormicodeDir(), 'hub.json');
  writeFileSync(path, JSON.stringify(c, null, 2), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* windows: mode is advisory */ }
}

interface Pending { hash: string; expiresAt: number; tries: number }

/** In-memory code book; codes die with the daemon, which is fine (10 min TTL). */
export class Pairing {
  private pending = new Map<string, Pending>();

  async createCode(): Promise<{ code: string; codeHash: string; expiresAt: number }> {
    const code = randomCode();
    const codeHash = await sha256hex(normalizeCode(code));
    const expiresAt = Date.now() + CODE_TTL_MS;
    this.pending.set(codeHash, { hash: codeHash, expiresAt, tries: 0 });
    return { code, codeHash, expiresAt };
  }

  /**
   * Verify a join attempt. Returns the minted device token on success; the
   * caller journals it away (raw token is never stored).
   */
  async join(db: Store, code: string, name: string): Promise<{ device: string; token: string; tokenHash: string; codeHash: string } | 'invalid' | 'burned' | 'expired'> {
    if (!/^\d{12}$/.test(normalizeCode(code))) return 'invalid';
    const codeHash = await sha256hex(normalizeCode(code));
    const p = this.pending.get(codeHash);
    // The hash is the lookup key: a correct code hits, a wrong one misses.
    if (!p) return 'invalid';
    if (p.expiresAt < Date.now()) { this.pending.delete(codeHash); return 'expired'; }
    if (++p.tries > MAX_TRIES) { this.pending.delete(codeHash); return 'burned'; }
    this.pending.delete(codeHash);
    const token = randomToken();
    const tokenHash = await sha256hex(token);
    const device = newId('d');
    addDevice(db, { id: device, name, tokenHash });
    return { device, token, tokenHash, codeHash };
  }
}

export type JoinOutcome =
  | { ok: true; device: string; name: string; token: string; tokenHash: string; codeHash: string }
  | { ok: false; reason: 'invalid' | 'burned' | 'expired' };

/** Shared join path for socket `pair.join` and relay `pair.join` messages. */
export async function handleJoin(pairing: Pairing, db: Store, code: string, name: string): Promise<JoinOutcome> {
  const r = await pairing.join(db, code, name);
  if (r === 'invalid' || r === 'burned' || r === 'expired') return { ok: false, reason: r };
  return { ok: true, ...r, name };
}

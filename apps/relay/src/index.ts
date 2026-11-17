/// <reference types="@cloudflare/workers-types" />
/**
 * ormicode relay worker. Routes: /register (bootstrap), /pair + /join
 * (pairing), /connect (hub + device sockets), /blob/<id> (R2). Everything
 * account-scoped lands in the AccountDO named `acct:<account>`.
 */
import { AccountDO } from './account.ts';
export { AccountDO };

export interface Env {
  ACCOUNT: DurableObjectNamespace;
  EVENTS: R2Bucket;
  BOOTSTRAP_SECRET?: string;
  /** Comma-separated origins allowed to open browser /connect sockets. Unset/empty = no browser clients. */
  ALLOWED_ORIGINS?: string;
}

// Per-isolate fixed-window limiter; the DO enforces the durable rules anyway.
const buckets = new Map<string, { reset: number; count: number }>();
function limited(ip: string, route: string, cap: number): boolean {
  const key = `${route}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { reset: now + 60_000, count: 1 }); return false; }
  b.count++;
  return b.count > cap;
}
const tooMany = () => new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });

const sha256hex = async (input: string): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const account = url.searchParams.get('account') ?? req.headers.get('x-ormi-account') ?? '';

    if (req.method === 'POST' && url.pathname === '/register') {
      if (limited(ip, 'register', 10)) return tooMany();
      const { hubToken, secret } = await req.json() as { hubToken?: string; secret?: string };
      if (!hubToken || !account) return new Response('account + hubToken required', { status: 400 });
      if (env.BOOTSTRAP_SECRET && secret !== env.BOOTSTRAP_SECRET) return new Response('forbidden', { status: 403 });
      const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(new Request('https://do/register', {
        method: 'POST', body: JSON.stringify({ hubTokenHash: await sha256hex(hubToken) }),
      }));
    }

    if (req.method === 'POST' && url.pathname === '/pair') {
      if (limited(ip, 'pair', 60)) return tooMany();
      if (!account) return new Response('account required', { status: 400 });
      const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }

    if (req.method === 'POST' && url.pathname === '/join') {
      if (limited(ip, 'join', 20)) return tooMany();
      if (!account) return new Response('account required', { status: 400 });
      const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }

    if (req.method === 'POST' && url.pathname === '/revoke') {
      if (!account) return new Response('account required', { status: 400 });
      const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }

    if (url.pathname === '/connect') {
      if (limited(ip, 'connect', 60)) return tooMany();
      if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      // Browsers send Origin; native clients don't. An Origin must be allowlisted.
      const origin = req.headers.get('origin');
      if (origin) {
        const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean);
        if (!allowed.includes(origin)) return new Response('origin not allowed', { status: 403 });
      }
      if (!account) return new Response('account required', { status: 400 });
      const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
      return stub.fetch(req);
    }

    if (url.pathname.startsWith('/blob/')) {
      if (limited(ip, 'blob', 120)) return tooMany();
      const id = url.pathname.slice('/blob/'.length);
      if (!id || !account) return new Response('bad blob path', { status: 400 });
      const key = `b/${account}/${id}`;
      if (req.method === 'PUT') {
        const len = Number(req.headers.get('content-length'));
        if (!len || len > 25 * 1024 * 1024) return new Response('content-length required, max 25MB', { status: 400 });
        const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
        const ok = await stub.fetch(new Request('https://do/auth-hub', { method: 'POST', body: JSON.stringify({ token: req.headers.get('authorization')?.replace(/^bearer\s+/i, '') }) }));
        if (!ok.ok) return new Response('unauthorized', { status: 401 });
        await env.EVENTS.put(key, req.body);
        return Response.json({ ok: true });
      }
      if (req.method === 'GET') {
        const bearer = req.headers.get('authorization')?.replace(/^bearer\s+/i, '') ?? '';
        if (!bearer) return new Response('unauthorized', { status: 401 });
        const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(`acct:${account}`));
        const ok = await stub.fetch(new Request('https://do/auth-any', { method: 'POST', body: JSON.stringify({ tokenHash: await sha256hex(bearer) }) }));
        if (!ok.ok) return new Response('unauthorized', { status: 401 });
        const obj = await env.EVENTS.get(key);
        if (!obj) return new Response('not found', { status: 404 });
        return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream' } });
      }
    }

    return new Response('ormicode relay', { status: 200 });
  },
};

import type { Frame } from '@ormicode/protocol';
import { parseRequestBody, newId } from '@ormicode/protocol';
import { getSession, listSessions, setState, listNotes, setNote, deleteNote, archiveSession, createSession, type Store } from '@ormicode/session-store';
import { replay, setCursor } from '@ormicode/journal';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import type { Link } from './socket.ts';
import { ormicodeDir } from './socket.ts';
import { acquireWorkspace, releaseForSession } from './leases.ts';
import { hasTransport } from './registry.ts';

export interface Client { link: Link; subscriptions: Set<string>; device: string }
export interface DispatchCtx {
  db: Store;
  notesDir: string;
  startedAt: number;
  lastError: () => string | null | undefined;
  liveWorkers: () => number;
  paused: Set<string>;
  heldPrompts: Map<string, { text: string; images?: unknown[] }[]>;
  lastPrompt: Map<string, { text: string; images?: unknown[] }>;
  spawnWorker(session: string): void;
  toWorker(session: string, method: string, body: Record<string, unknown>): Promise<Frame | undefined>;
  sendPrompt(session: string, text: string, images?: unknown[]): Promise<boolean>;
}

/** Client-facing session.* / daemon.* request dispatch. */
export async function onClientFrame(ctx: DispatchCtx, client: Client, frame: Frame): Promise<void> {
  const { db } = ctx;
  if (frame.type === 'ack') {
    // Per-device replay cursor: the client has durably seen up to seq.
    if (typeof frame.session === 'string' && typeof frame.seq === 'number')
      setCursor(db, client.device, frame.session, frame.seq);
    return;
  }
  if (frame.type !== 'req') return;
  const { id, method } = frame;
  const parsed = parseRequestBody(method, frame.body);
  if (!parsed.success) return client.link.replyError(id, parsed.error, method);
  const body = parsed.data as Record<string, unknown>;
  try {
    switch (method) {
      case 'daemon.status':
        return client.link.reply(id, { version: '0.0.0', uptimeMs: Date.now() - ctx.startedAt, liveWorkers: ctx.liveWorkers(), relay: 'disconnected', lastError: ctx.lastError() });
      case 'session.start': {
        const vendor = String(body.vendor); const transport = String(body.transport);
        if (!hasTransport(vendor, transport)) return client.link.replyError(id, 'agent.unsupported', `${vendor}/${transport}`);
        const sessionId = newId('s');
        const workspace = body.workspace as { kind?: string } | undefined;
        const cwd = workspace?.kind === 'scratch'
          ? join(ormicodeDir(), 'scratch', sessionId)
          : process.cwd();
        if (workspace?.kind === 'scratch') mkdirSync(cwd, { recursive: true });
        const lease = acquireWorkspace(db, cwd, sessionId, String(body.machine ?? 'm_local'));
        if (lease.conflict) return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
        createSession(db, {
          id: sessionId, machine: String(body.machine ?? 'm_local'), project: String(body.project),
          vendor, transport, cwd,
          ...(body.model ? { model: String(body.model) } : {}),
          ...(body.effort ? { effort: String(body.effort) } : {}),
          ...(body.mode ? { mode: String(body.mode) } : {}),
          ...(body.agentCommand ? { agentCommand: String(body.agentCommand) } : {}),
          ...(body.agentArgs ? { agentArgs: body.agentArgs as string[] } : {}),
        });
        ctx.spawnWorker(sessionId);
        return client.link.reply(id, { session: sessionId });
      }
      case 'session.list': {
        const sessions = listSessions(db, Boolean(body.archived)).map(s => ({
          id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
          transport: s.transport, updatedAt: s.updated_at,
        }));
        return client.link.reply(id, { sessions });
      }
      case 'session.get': {
        const s = getSession(db, String(body.session));
        if (!s) return client.link.replyError(id, 'session.not_found', String(body.session));
        return client.link.reply(id, {
          id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
          transport: s.transport, updatedAt: s.updated_at, model: s.model, effort: s.effort,
          nativeId: s.native_id, acpVersion: s.acp_version,
        });
      }
      case 'session.prompt': {
        const session = String(body.session);
        const s = getSession(db, session);
        if (!s) return client.link.replyError(id, 'session.not_found', session);
        if (s.state === 'running') return client.link.replyError(id, 'session.busy', 'turn in progress');
        if (ctx.paused.has(session)) {
          const held = ctx.heldPrompts.get(session) ?? [];
          held.push({ text: String(body.text), ...(body.images ? { images: body.images as unknown[] } : {}) });
          ctx.heldPrompts.set(session, held);
          return client.link.reply(id, { accepted: true });
        }
        const sent = await ctx.sendPrompt(session, String(body.text), body.images as unknown[] | undefined);
        return sent ? client.link.reply(id, { accepted: true }) : client.link.replyError(id, 'agent.failed', 'worker rejected prompt');
      }
      case 'session.pause':
        ctx.paused.add(String(body.session));
        return client.link.reply(id, { paused: true });
      case 'session.resume': {
        const session = String(body.session);
        ctx.paused.delete(session);
        const held = ctx.heldPrompts.get(session) ?? [];
        ctx.heldPrompts.delete(session);
        for (const p of held) {
          try {
            if (!await ctx.sendPrompt(session, p.text, p.images)) {
              ctx.heldPrompts.set(session, held.slice(held.indexOf(p)));
              return client.link.replyError(id, 'agent.failed', 'held prompt rejected');
            }
          } catch (error) {
            ctx.heldPrompts.set(session, held.slice(held.indexOf(p)));
            return client.link.replyError(id, 'agent.failed', error instanceof Error ? error.message : String(error));
          }
        }
        return client.link.reply(id, { resumed: true });
      }
      case 'session.retry': {
        const session = String(body.session);
        const last = ctx.lastPrompt.get(session);
        if (!last) return client.link.replyError(id, 'session.not_found', 'no prompt to retry');
        return await ctx.sendPrompt(session, last.text, last.images)
          ? client.link.reply(id, { accepted: true })
          : client.link.replyError(id, 'agent.failed', 'worker rejected retry');
      }
      case 'session.delete': case 'session.archive': {
        const session = String(body.session);
        archiveSession(db, session);
        releaseForSession(db, session);
        // Scratch sessions own their folder; delete removes it (archive keeps it).
        const row = getSession(db, session);
        const scratchRoot = join(ormicodeDir(), 'scratch');
        if (method === 'session.delete' && row?.cwd.startsWith(scratchRoot)) {
          try { rmSync(row.cwd, { recursive: true, force: true }); } catch { /* best effort */ }
        }
        return client.link.reply(id, method === 'session.delete' ? { deleted: true } : { archived: true });
      }
      case 'session.setModel': case 'session.setEffort': case 'session.setMode': case 'session.setOption': {
        const session = String(body.session);
        const column = method === 'session.setModel' ? 'model' : method === 'session.setEffort' ? 'effort' : method === 'session.setMode' ? 'mode' : undefined;
        const kind = column ?? 'option';
        const res = await ctx.toWorker(session, 'worker.configure', { kind, ...(kind === 'option' ? { id: body.id } : {}), value: body.value ?? body.model ?? body.effort ?? body.mode });
        if (res?.type !== 'res') return client.link.replyError(id, 'agent.unsupported', kind);
        if (column) db.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`).run(String(body[column] ?? ''), session);
        return client.link.reply(id, { updated: true });
      }
      case 'session.answer': {
        const res = await ctx.toWorker(String(body.session), 'worker.answer', { request: body.request, answers: body.answers });
        return res?.type === 'res' ? client.link.reply(id, { answered: true }) : client.link.replyError(id, 'agent.unsupported', 'answer');
      }
      case 'session.getNotes':
        return client.link.reply(id, { notes: listNotes(ctx.notesDir, String(body.session)) });
      case 'session.setNotes': {
        const noteId = setNote(ctx.notesDir, String(body.session), { ...(body.id ? { id: String(body.id) } : {}), title: String(body.title), body: String(body.body) }, () => newId('n'));
        return client.link.reply(id, { id: noteId });
      }
      case 'session.deleteNote':
        return deleteNote(ctx.notesDir, String(body.session), String(body.id))
          ? client.link.reply(id, { deleted: true })
          : client.link.replyError(id, 'session.not_found', String(body.id));
      case 'session.steer': {
        const res = await ctx.toWorker(String(body.session), 'worker.steer', { text: body.text });
        return res?.type === 'res' ? client.link.reply(id, { accepted: true, queued: false }) : client.link.replyError(id, 'agent.unsupported', 'steer');
      }
      case 'session.abort': {
        const res = await ctx.toWorker(String(body.session), 'worker.abort', {});
        return res?.type === 'res' ? client.link.reply(id, { interrupted: true }) : client.link.replyError(id, 'agent.unsupported', 'abort');
      }
      case 'session.decide': {
        const res = await ctx.toWorker(String(body.session), 'worker.decide', { request: body.request, option: body.option });
        return res?.type === 'res' ? client.link.reply(id, { decided: true }) : client.link.replyError(id, 'agent.unsupported', 'decide');
      }
      case 'session.subscribe': {
        const session = String(body.session);
        client.subscriptions.add(session);
        for (const row of replay(db, session, Number(body.after ?? 0))) {
          client.link.send(JSON.parse(JSON.stringify({ v: 1, type: 'evt', session, seq: row.seq, ts: row.ts, body: JSON.parse(row.payload) })));
        }
        return client.link.reply(id, { subscribed: true });
      }
      case 'session.unsubscribe':
        client.subscriptions.delete(String(body.session));
        return client.link.reply(id, { unsubscribed: true });
      default:
        return client.link.replyError(id, 'protocol.unimplemented', method);
    }
  } catch (error) {
    return client.link.replyError(id, 'daemon.error', error instanceof Error ? error.message : String(error));
  }
}

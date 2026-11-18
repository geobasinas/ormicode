import type { Frame } from '@ormicode/protocol';
import { parseRequestBody, newId } from '@ormicode/protocol';
import { getSession, listSessions, sessionsInStates, setState, setTitle, listNotes, setNote, deleteNote, archiveSession, createSession, type Store } from '@ormicode/session-store';
import { replay, setCursor } from '@ormicode/journal';
import { listDevices, renameDevice, revokeDevice } from '@ormicode/session-store';
import { handleJoin, type Pairing } from './pair.ts';
import { handoffBrief } from './handoff.ts';
import type { RelayClient } from './relay.ts';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

import { ormicodeDir, sessionLogDir } from './socket.ts';
import { acquireWorkspace, releaseForSession } from '@ormicode/leases';
import { hasTransport, agentList } from './registry.ts';
import { resolveWorkspace, diffPatch, DiffStatCache, type WorkspaceChoice } from '@ormicode/git-core';

const diffStats = new DiffStatCache();
const PATCH_INLINE = 256 * 1024;
import type { Checkpoints } from '@ormicode/checkpoints';
import { loadTable, summarize } from '@ormicode/pricing';
import { checkpointMethod } from './checkpoint-methods.ts';

const LIVE_STATES = ['idle', 'starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited', 'interrupted'] as const;

/** What a client transport must do: send frames and answer requests. */
export interface ClientLink {
  send(frame: Frame | Record<string, unknown>): void;
  reply(id: string, body: Record<string, unknown>): void;
  replyError(id: string, code: string, message: string): void;
  closed: boolean;
  close(): void;
}
export interface Client { link: ClientLink; subscriptions: Set<string>; device: string }
export interface DispatchCtx {
  db: Store;
  notesDir: string;
  startedAt: number;
  lastError: () => string | null | undefined;
  liveWorkers: () => number;
  paused: Set<string>;
  heldPrompts: Map<string, { text: string; images?: unknown[] }[]>;
  lastPrompt: Map<string, { text: string; images?: unknown[] }>;
  /** Handoffs since the session's last turn_start — cleared by the supervisor. */
  handoffsInTurn: Map<string, number>;
  spawnWorker(session: string): void;
  toWorker(session: string, method: string, body: Record<string, unknown>): Promise<Frame | undefined>;
  sendPrompt(session: string, text: string, images?: unknown[], opts?: { journal?: boolean }): Promise<boolean>;
  pairing: Pairing;
  relay(): RelayClient | undefined;
  checkpoints: Checkpoints;
  record(session: string, kind: string, payload: Record<string, unknown>): void;
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
      case 'agents.list':
        return client.link.reply(id, { agents: agentList() });
      case 'daemon.status':
        return client.link.reply(id, { version: '0.0.0', uptimeMs: Date.now() - ctx.startedAt, liveWorkers: ctx.liveWorkers(), relay: ctx.relay()?.connected() ? 'connected' : 'disconnected', lastError: ctx.lastError() });
      case 'session.start': {
        const vendor = String(body.vendor); const transport = String(body.transport);
        if (!hasTransport(vendor, transport)) return client.link.replyError(id, 'agent.unsupported', `${vendor}/${transport}`);
        const sessionId = newId('s');
        const project = String(body.project);
        const workspace = body.workspace as { kind: string; branch?: string };
        let resolved: { cwd: string; worktree?: string; branch?: string; baseBranch?: string; baseCommit?: string };
        if (workspace.kind === 'scratch') {
          resolved = { cwd: join(ormicodeDir(), 'scratch', sessionId) };
          mkdirSync(resolved.cwd, { recursive: true });
        } else {
          // Busy = another live session holds this project+branch already.
          const busy = (branch: string) => sessionsInStates(db, LIVE_STATES)
            .some(s => s.id !== sessionId && s.project === project && s.branch === branch);
          const r = resolveWorkspace(project, workspace as WorkspaceChoice, body.workspaceName as string | undefined, sessionId, busy);
          if ('err' in r) return client.link.replyError(id, r.err, r.detail ?? r.err);
          resolved = r;
        }
        const cwd = resolved.cwd;
        const lease = acquireWorkspace(db, cwd, sessionId, String(body.machine ?? 'm_local'));
        if (lease.conflict) return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
        createSession(db, {
          id: sessionId, machine: String(body.machine ?? 'm_local'), project,
          vendor, transport, cwd,
          worktree: resolved.worktree, branch: resolved.branch,
          baseBranch: resolved.baseBranch, baseCommit: resolved.baseCommit,
          // 'default' is a client placeholder, not a vendor value — leave unset.
          ...(body.model && body.model !== 'default' ? { model: String(body.model) } : {}),
          ...(body.effort && body.effort !== 'default' ? { effort: String(body.effort) } : {}),
          ...(body.mode && body.mode !== 'default' ? { mode: String(body.mode) } : {}),
          ...(body.agentCommand ? { agentCommand: String(body.agentCommand) } : {}),
          ...(body.agentArgs ? { agentArgs: body.agentArgs as string[] } : {}),
          ...(body.parent ? { parent: String(body.parent) } : {}),
        });
        ctx.spawnWorker(sessionId);
        return client.link.reply(id, { session: sessionId });
      }
      case 'session.list': {
        const sessions = listSessions(db, Boolean(body.archived)).map(s => ({
          id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
          transport: s.transport, updatedAt: s.updated_at, branch: s.branch,
          worktree: Boolean(s.worktree),
          ...(s.base_commit && !s.archived ? { diff: diffStats.get(s.cwd, s.base_commit) } : {}),
        }));
        return client.link.reply(id, { sessions });
      }
      case 'session.cost': {
        const s = getSession(db, String(body.session));
        if (!s) return client.link.replyError(id, 'session.not_found', String(body.session));
        const events = replay(db, s.id).filter(e => e.kind === 'usage' || e.kind === 'turn_end')
          .map(e => ({ kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown> }));
        return client.link.reply(id, { ...summarize(events, s.model, loadTable(join(ormicodeDir(), 'prices.json'))) });
      }
      case 'git.diff': {
        const s = getSession(db, String(body.session));
        if (!s) return client.link.replyError(id, 'session.not_found', String(body.session));
        if (!s.base_commit) return client.link.replyError(id, 'git.failed', 'session has no recorded base commit');
        const { patch, files } = diffPatch(s.cwd, s.base_commit);
        return client.link.reply(id, {
          files: files.map(f => ({ path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}), status: f.status, binary: f.binary, added: f.added, removed: f.removed })),
          patch: patch.length > PATCH_INLINE ? patch.slice(0, PATCH_INLINE) : patch, truncated: patch.length > PATCH_INLINE,
        });
      }
      case 'session.get': {
        const s = getSession(db, String(body.session));
        if (!s) return client.link.replyError(id, 'session.not_found', String(body.session));
        return client.link.reply(id, {
          id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
          transport: s.transport, updatedAt: s.updated_at, branch: s.branch, model: s.model, effort: s.effort, mode: s.mode,
          nativeId: s.native_id, acpVersion: s.acp_version, parent: s.parent,
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
        // Untitled sessions pick up the first real prompt as their title.
        if (!s.title) {
          const first = String(body.text).split('\n').map(l => l.trim()).find(Boolean) ?? '';
          if (first) setTitle(ctx.db, session, first.length > 60 ? `${first.slice(0, 57)}…` : first);
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
        return await ctx.sendPrompt(session, last.text, last.images, { journal: false })
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
        if (method === 'session.delete') {
          try { rmSync(sessionLogDir(session), { recursive: true, force: true }); } catch { /* best effort */ }
          void ctx.checkpoints.remove(session).catch(() => undefined);
        }
        return client.link.reply(id, method === 'session.delete' ? { deleted: true } : { archived: true });
      }
      case 'session.handoff': {
        const session = String(body.session);
        const s = getSession(db, session);
        if (!s) return client.link.replyError(id, 'session.not_found', session);
        const to = body.to as { vendor?: string; transport?: string; model?: string; effort?: string; branch?: string };
        const mode = String(body.mode);
        const reason = typeof body.reason === 'string' ? body.reason : undefined;
        // At most one handoff per turn — the count only gates a session that
        // is actually mid-turn; starting/idle/done sessions aren't in one.
        const inTurn = ['running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'].includes(s.state);
        if (inTurn && (ctx.handoffsInTurn.get(session) ?? 0) >= 1)
          return client.link.replyError(id, 'handoff.limit', 'one handoff per turn');
        if (mode === 'in_place') {
          // Same session, new model/effort — the worker stays put.
          for (const [kind, value] of [['model', to.model], ['effort', to.effort]] as const) {
            if (!value) continue;
            const res = await ctx.toWorker(session, 'worker.configure', { kind, value });
            if (res?.type === 'res') db.prepare(`UPDATE sessions SET ${kind} = ? WHERE id = ?`).run(value, session);
          }
          ctx.handoffsInTurn.set(session, (ctx.handoffsInTurn.get(session) ?? 0) + 1);
          return client.link.reply(id, { session: s.id, brief: '', parent: s.id });
        }
        // Guards: at most 3 handoffs per task chain, and no A→B→A bounce.
        let depth = 0; let cur = s.parent as string | null;
        while (cur) { depth++; cur = getSession(db, cur)?.parent ?? null; }
        if (depth >= 3) return client.link.replyError(id, 'handoff.limit', 'max handoffs per task');
        const targetVendor = to.vendor ?? s.vendor;
        const parentRow = s.parent ? getSession(db, s.parent) : undefined;
        if (parentRow && parentRow.vendor === targetVendor && parentRow.vendor !== s.vendor)
          return client.link.replyError(id, 'handoff.bounce', `cannot hand back to ${targetVendor}`);
        if (!hasTransport(targetVendor, to.transport ?? s.transport))
          return client.link.replyError(id, 'agent.unsupported', `${targetVendor}/${to.transport ?? s.transport}`);
        // fork gets a new branch; rehydrate takes over the same workspace.
        let resolved = { cwd: s.cwd, worktree: s.worktree ?? undefined, branch: s.branch ?? undefined };
        if (mode === 'fork') {
          const r = resolveWorkspace(s.project, { kind: 'branch', branch: to.branch ?? `handoff/${newId('s')}` }, undefined, session, () => false);
          if ('err' in r) return client.link.replyError(id, r.err, r.detail ?? r.err);
          resolved = { cwd: r.cwd, worktree: r.worktree, branch: r.branch };
        } else {
          // Old session is handed off — release its lease so the new one can take it.
          releaseForSession(db, session);
          const lease = acquireWorkspace(db, resolved.cwd, session, s.machine);
          if (lease.conflict) return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
        }
        const brief = typeof body.brief === 'string' && body.brief ? body.brief : handoffBrief(db, session);
        const child = newId('s');
        createSession(db, {
          id: child, machine: s.machine, project: s.project, vendor: targetVendor,
          transport: to.transport ?? s.transport, cwd: resolved.cwd,
          worktree: resolved.worktree, branch: resolved.branch,
          ...(to.model ?? s.model ? { model: String(to.model ?? s.model) } : {}),
          ...(to.effort ?? s.effort ? { effort: String(to.effort ?? s.effort) } : {}),
          ...(s.mode ? { mode: s.mode } : {}),
          title: s.title ?? undefined, parent: s.id,
        });
        db.prepare('UPDATE sessions SET handed_off = 1, state = ? WHERE id = ?').run('done', session);
        ctx.handoffsInTurn.set(session, (ctx.handoffsInTurn.get(session) ?? 0) + 1);
        ctx.spawnWorker(child);
        // The brief is the new agent's first prompt — same path as restart recaps.
        // If the child never starts, roll back: mark it failed and hand the
        // workspace lease + live flag back to the parent session.
        const rollback = () => {
          try {
            setState(db, child, 'failed', 'handoff_failed');
            db.prepare(`UPDATE sessions SET handed_off = 0, state = 'idle' WHERE id = ?`).run(session);
          } catch { /* daemon closing */ }
        };
        void ctx.sendPrompt(child, `You are taking over this task${reason ? ` — ${reason}` : ''}. Handoff brief:\n${brief}\nContinue where the previous session left off.`, undefined, { journal: false })
          .then(ok => { if (!ok) rollback(); })
          .catch(rollback);
        return client.link.reply(id, { session: child, brief, parent: s.id });
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
      case 'pair.create': {
        const { code, codeHash, expiresAt } = await ctx.pairing.createCode();
        ctx.relay()?.pushCode(codeHash, expiresAt);
        return client.link.reply(id, { code, expiresAt, link: `ormi://pair?c=${code.replace(/\s/g, '')}` });
      }
      case 'pair.join': {
        const r = await handleJoin(ctx.pairing, db, String(body.code), String(body.name));
        if (!r.ok) return client.link.replyError(id, `pairing.${r.reason === 'invalid' ? 'invalid_code' : r.reason}`, `pairing ${r.reason}`);
        ctx.relay()?.deviceAdd(r.device, r.name, r.tokenHash);
        return client.link.reply(id, { device: r.device, token: r.token });
      }
      case 'devices.list': {
        const devices = listDevices(db).map(d => ({ id: d.id, name: d.name, trustedAt: d.trusted_at }));
        return client.link.reply(id, { devices });
      }
      case 'devices.rename': {
        return renameDevice(db, String(body.device), String(body.name))
          ? client.link.reply(id, { renamed: true })
          : client.link.replyError(id, 'devices.not_found', String(body.device));
      }
      case 'devices.revoke': {
        const target = listDevices(db).find(d => d.id === String(body.device));
        if (!target) return client.link.replyError(id, 'devices.not_found', String(body.device));
        if (body.confirm !== target.name) return client.link.replyError(id, 'devices.confirm_mismatch', 'confirm must equal the device name');
        revokeDevice(db, target.id);
        const relay = ctx.relay();
        relay?.deviceRevoke(target.id);
        return client.link.reply(id, { revoked: true, relaySynced: relay?.connected() ?? false });
      }
      default:
        if (method.startsWith('checkpoint.')) return await checkpointMethod(ctx, client, id, method, body);
        return client.link.replyError(id, 'protocol.unimplemented', method);
    }
  } catch (error) {
    return client.link.replyError(id, 'daemon.error', error instanceof Error ? error.message : String(error));
  }
}

import type { Frame, PromptAttachment, PromptContext } from '@ormicode/protocol';
import { parseRequestBody, newId, PROTOCOL_VERSION } from '@ormicode/protocol';
import {
  getSession, listSessions, setState, setTitle, listNotes, setNote, deleteNote, archiveSession, releaseSessionPorts,
  getPendingPromptData, deletePendingPromptData, getSessionPorts, type Store,
} from '@ormicode/session-store';
import { replay, setCursor } from '@ormicode/journal';
import { listDevices, renameDevice, revokeDevice } from '@ormicode/session-store';
import { handleJoin, type Pairing } from './pair.ts';
import { handoffMethod } from './handoff-methods.ts';
import { handoffRequest, resolveHandoffApproval } from './handoff-dispatch.ts';
import type { RelayClient } from './relay.ts';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { ormicodeDir, sessionLogDir } from './socket.ts';
import { releaseForSession } from '@ormicode/leases';
import { agentList } from './registry.ts';
import {
  diffPatch, DiffStatCache,
} from '@ormicode/git-core';

const diffStats = new DiffStatCache();
const PATCH_INLINE = 256 * 1024;
import type { Checkpoints } from '@ormicode/checkpoints';
import type { SecretBroker } from './secrets.ts';
import { secretMethod } from './secret-methods.ts';
import type { TerminalHub } from './terminal-methods.ts';
import { priceFor, type PriceBook } from '@ormicode/pricing';
import { summarize as digestOf, rank as rankDigest } from '@ormicode/digest';
import { checkpointMethod } from './checkpoint-methods.ts';
import { costMethod } from './cost-methods.ts';
import { gitMethod, projectBranches, projectFetch } from './git-methods.ts';
import { projectBranchMethod } from './project-branch-methods.ts';
import { fileMethod } from './file-methods.ts';
import { designMethod } from './design-methods.ts';
import { projectSearchFiles } from './project-search.ts';
import { queueMethod } from './queue-methods.ts';
import { composerMethod } from './composer-methods.ts';
import { expandPrompt, PromptInvalidError, validatePrompt } from './prompt-context.ts';
import { retryPrompt } from './prompt-methods.ts';
import { listModels } from './models.ts';
import { startSession } from './session-start.ts';
import { copyOutMethod, countScratchFiles } from './scratch-methods.ts';
import { SESSION_PORT_COUNT } from './session-ports.ts';
import { serviceMethod } from './service-methods.ts';
import type { Services } from './services.ts';
import type { AgentBrowser } from './agent-browser.ts';
import { browserMethod } from './browser-methods.ts';
import { shouldResetUiCheckFollowups } from './ui-check.ts'; import { machineMethod } from './machine-methods.ts';

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
  heldPrompts: Map<string, { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' }[]>;
  lastPrompt: Map<string, { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' }>;
  /** Handoffs since the session's last turn_start — cleared by the supervisor. */
  handoffsInTurn: Map<string, number>;
  resetUiCheckFollowups(session: string): void;
  spawnWorker(session: string): void;
  ensureWorker(session: string, timeoutMs?: number): Promise<void>;
  stopWorker(session: string): Promise<void>;
  setRecapPending(session: string, uptoSeq: number): void;
  toWorker(session: string, method: string, body: Record<string, unknown>): Promise<Frame | undefined>;
  sendPrompt(session: string, text: string, images?: unknown[], opts?: { journal?: boolean; context?: PromptContext[]; attachments?: PromptAttachment[] }): Promise<boolean>;
  drainQueue(session: string, afterTurnEnd?: boolean): Promise<boolean>;
  pairing: Pairing;
  relay(): RelayClient | undefined;
  checkpoints: Checkpoints;
  secrets: SecretBroker;
  terminals: TerminalHub;
  services: Services;
  agentBrowser: AgentBrowser;
  prices: PriceBook;
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
      case 'machine.list': case 'fs.browse': case 'project.list': case 'project.add': case 'project.remove': return await machineMethod(ctx, client, id, method, body);
      case 'models.list':
        return client.link.reply(id, await listModels(body as { agent?: string; transport?: string; refresh?: boolean }));
      case 'project.branches': return projectBranches(ctx, client, id, body);
      case 'project.searchFiles': return projectSearchFiles(client, id, body);
      case 'project.fetch': return await projectFetch(ctx, client, id, body);
      case 'project.pull':
      case 'project.renameBranch':
      case 'project.deleteBranch':
        return await projectBranchMethod(ctx, client, id, method, body);
      case 'daemon.status':
        return client.link.reply(id, { version: '0.0.0', proto: PROTOCOL_VERSION, uptimeMs: Date.now() - ctx.startedAt, liveWorkers: ctx.liveWorkers(), relay: ctx.relay()?.connected() ? 'connected' : 'disconnected', lastError: ctx.lastError() });
      case 'session.start': return await startSession(ctx, client, id, body);
      case 'session.rename': {
        const session = String(body.session);
        const title = String(body.title).trim();
        if (!getSession(db, session)) return client.link.replyError(id, 'session.not_found', session);
        if (!title) return client.link.replyError(id, 'session.invalid_title', 'title must not be empty');
        setTitle(db, session, title);
        ctx.record(session, 'renamed', { title });
        return client.link.reply(id, { renamed: true, title });
      }
      case 'session.export': {
        const session = String(body.session);
        const row = getSession(db, session);
        if (!row) return client.link.replyError(id, 'session.not_found', session);
        const lines = [`# ${row.title ?? `${row.vendor} session`}`, '', `Project: ${row.project}`, ''];
        for (const event of replay(db, session)) {
          const payload = JSON.parse(event.payload) as Record<string, unknown>;
          if (event.kind === 'prompt') lines.push(`## User\n\n${String(payload.text ?? '')}\n`);
          else if (event.kind === 'text') lines.push(`## Assistant\n\n${String(payload.text ?? '')}\n`);
          else if (event.kind === 'error') lines.push(`> Error: ${String(payload.message ?? payload.code ?? '')}\n`);
        }
        return client.link.reply(id, { text: lines.join('\n') });
      }
      case 'session.list': {
        const sessions = listSessions(db, Boolean(body.archived)).map(s => {
          const base = getSessionPorts(db, s.id);
          return {
            id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
            transport: s.transport, updatedAt: s.updated_at, branch: s.branch,
            worktree: Boolean(s.worktree),
            ...(base === undefined ? {} : { ports: { base, count: SESSION_PORT_COUNT } }),
            ...(s.base_commit && !s.archived ? { diff: diffStats.get(s.cwd, s.base_commit) } : {}),
          };
        });
        return client.link.reply(id, { sessions });
      }
      case 'session.digest': {
        const since = Number(body.since); const computedAt = Date.now();
        const entries = listSessions(db).map(s => digestOf({ id: s.id, state: s.state, updatedAt: s.updated_at },
          replay(db, s.id).filter(e => e.ts > since).map(e => ({ seq: e.seq, ts: e.ts, kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown> })),
          since, computedAt));
        return client.link.reply(id, { since, computedAt, entries: rankDigest(entries) });
      }
      case 'session.cost':
      case 'cost.totals':
        return costMethod(ctx, client, id, method, body);
      case 'service.list':
      case 'service.start':
      case 'service.stop':
      case 'service.restart':
      case 'service.logs':
      case 'preview.url':
      case 'preview.fetch':
      case 'preview.fetchMore':
      case 'preview.console':
      case 'preview.consoleClear':
        return await serviceMethod(ctx, client, id, method, body);
      case 'browser.status': case 'browser.settings': case 'browser.setSettings': case 'browser.install': case 'browser.diff':
      case 'browser.open': case 'browser.click': case 'browser.type': case 'browser.snapshot':
      case 'browser.screenshot': case 'browser.close': case 'browser.artifact':
        return await browserMethod(ctx, client, id, method, body);
      case 'pricing.status':
      case 'pricing.refresh':
        await ctx.prices.ensure(method === 'pricing.refresh');
        return client.link.reply(id, { ...ctx.prices.status() });
      case 'pricing.get': {
        await ctx.prices.ensure();
        const price = priceFor(ctx.prices.table(), String(body.model));
        return client.link.reply(id, { model: String(body.model), price: price ?? null, version: ctx.prices.table().version });
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
        const base = getSessionPorts(db, s.id);
        return client.link.reply(id, {
          id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
          cwd: s.cwd,
          ...(s.project === 'scratch' ? { scratchFiles: countScratchFiles(s.cwd) } : {}),
          transport: s.transport, updatedAt: s.updated_at, branch: s.branch, worktree: Boolean(s.worktree),
          ...(base === undefined ? {} : { ports: { base, count: SESSION_PORT_COUNT } }),
          model: s.model, effort: s.effort, mode: s.mode,
          nativeId: s.native_id, acpVersion: s.acp_version, parent: s.parent,
        });
      }
      case 'session.copyOut': return copyOutMethod(ctx, client, id, body);
      case 'session.prompt': {
        const session = String(body.session);
        const s = getSession(db, session);
        if (!s) return client.link.replyError(id, 'session.not_found', session);
        if (s.state === 'running') return client.link.replyError(id, 'session.busy', 'turn in progress');
        const pending = getPendingPromptData(db, session);
        const context = [...(pending?.context ?? []), ...(body.context as PromptContext[] | undefined ?? [])];
        const attachments = [...(pending?.attachments ?? []), ...(body.attachments as PromptAttachment[] | undefined ?? [])];
        try { validatePrompt(s.cwd, { text: String(body.text), context, attachments }); }
        catch (error) { return client.link.replyError(id, 'prompt.invalid', error instanceof Error ? error.message : String(error)); }
        if (ctx.paused.has(session)) {
          if (shouldResetUiCheckFollowups(client.device)) ctx.resetUiCheckFollowups(session);
          const held = ctx.heldPrompts.get(session) ?? [];
          held.push({ text: String(body.text), ...(body.images ? { images: body.images as unknown[] } : {}), ...(context.length ? { context } : {}), ...(attachments.length ? { attachments } : {}) });
          ctx.heldPrompts.set(session, held);
          if (pending) deletePendingPromptData(db, session);
          return client.link.reply(id, { accepted: true });
        }
        // Untitled sessions pick up the first real prompt as their title.
        if (!s.title) {
          const first = String(body.text).split('\n').map(l => l.trim()).find(Boolean) ?? '';
          if (first) setTitle(ctx.db, session, first.length > 60 ? `${first.slice(0, 57)}…` : first);
        }
        let sent: boolean;
        try {
          sent = await ctx.sendPrompt(session, String(body.text), body.images as unknown[] | undefined, { context, attachments });
        } catch (error) {
          if (error instanceof PromptInvalidError) return client.link.replyError(id, 'prompt.invalid', error.message);
          throw error;
        }
        if (sent && shouldResetUiCheckFollowups(client.device)) ctx.resetUiCheckFollowups(session);
        if (sent && pending) deletePendingPromptData(db, session);
        return sent ? client.link.reply(id, { accepted: true }) : client.link.replyError(id, 'agent.failed', 'worker rejected prompt');
      }
      case 'session.queue.add':
      case 'session.queue.list':
      case 'session.queue.update':
      case 'session.queue.remove':
      case 'session.queue.move':
        return queueMethod(ctx, client, id, method, body);
      case 'session.pause':
        ctx.paused.add(String(body.session));
        return client.link.reply(id, { paused: true });
      case 'session.resume': {
        const session = String(body.session);
        ctx.paused.delete(session);
        if (!await ctx.drainQueue(session)) return client.link.replyError(id, 'agent.failed', 'held or queued prompt rejected');
        return client.link.reply(id, { resumed: true });
      }
      case 'session.retry': return await retryPrompt(ctx, client, id, body);
      case 'session.delete': case 'session.archive': {
        const session = String(body.session);
        if (method === 'session.delete') await ctx.agentBrowser.deleteSession(session);
        else await ctx.agentBrowser.closeSession(session);
        await ctx.services.stopSession(session);
        archiveSession(db, session);
        releaseForSession(db, session);
        // Scratch sessions own their folder; delete removes it (archive keeps it).
        const row = getSession(db, session);
        const scratchRoot = join(ormicodeDir(), 'scratch');
        if (method === 'session.delete' && row?.cwd.startsWith(scratchRoot)) {
          try { rmSync(row.cwd, { recursive: true, force: true }); } catch { /* best effort */ }
        }
        if (method === 'session.delete') {
          releaseSessionPorts(db, session);
          try { rmSync(sessionLogDir(session), { recursive: true, force: true }); } catch { /* best effort */ }
          void ctx.checkpoints.remove(session).catch(() => undefined);
        }
        return client.link.reply(id, method === 'session.delete' ? { deleted: true } : { archived: true });
      }
      case 'session.handoff': return await handoffRequest(ctx, client, id, body);
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
        const session = String(body.session);
        const row = getSession(db, session);
        if (!row) return client.link.replyError(id, 'session.not_found', session);
        const pending = getPendingPromptData(db, session);
        const context = [...(pending?.context ?? []), ...(body.context as PromptContext[] | undefined ?? [])];
        const attachments = [...(pending?.attachments ?? []), ...(body.attachments as PromptAttachment[] | undefined ?? [])];
        let prepared: ReturnType<typeof expandPrompt>;
        try {
          prepared = expandPrompt({ cwd: row.cwd, session, baseCommit: row.base_commit, notesDir: ctx.notesDir, terminalOutput: (s, terminal) => ctx.terminals.recentOutput(s, terminal), previewEntries: (s, ids) => ctx.services.previewEntries(s, ids) },
            { text: String(body.text), context, attachments });
        } catch (error) {
          return client.link.replyError(id, 'prompt.invalid', error instanceof Error ? error.message : String(error));
        }
        const res = await ctx.toWorker(session, 'worker.steer', { text: prepared.text });
        if (res?.type !== 'res') return client.link.replyError(id, 'agent.unsupported', 'steer');
        if (shouldResetUiCheckFollowups(client.device)) ctx.resetUiCheckFollowups(session);
        ctx.record(session, 'prompt', { text: String(body.text), ...(context.length ? { context } : {}), ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}) });
        if (pending) deletePendingPromptData(db, session);
        return client.link.reply(id, { accepted: true, queued: false });
      }
      case 'session.abort': {
        const res = await ctx.toWorker(String(body.session), 'worker.abort', {});
        return res?.type === 'res' ? client.link.reply(id, { interrupted: true }) : client.link.replyError(id, 'agent.unsupported', 'abort');
      }
      case 'session.decide': {
        const session = String(body.session);
        const request = String(body.request);
        if (resolveHandoffApproval(ctx, session, request, String(body.option)))
          return client.link.reply(id, { decided: true });
        const res = await ctx.toWorker(session, 'worker.decide', { request, option: body.option });
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
        ctx.terminals.killDevice(target.id).catch(() => undefined);
        const relay = ctx.relay();
        relay?.deviceRevoke(target.id);
        return client.link.reply(id, { revoked: true, relaySynced: relay?.connected() ?? false });
      }
      default:
        if (method.startsWith('design.')) return designMethod(ctx, client, id, method, body);
        if (method === 'session.handoffEstimate' || method === 'session.handoffBrief')
          return await handoffMethod(ctx, client, id, method, body);
        if (method === 'session.draft.get' || method === 'session.draft.set' || method === 'session.commands' || method === 'prompts.history')
          return await composerMethod(ctx, client, id, method, body);
        if (method.startsWith('git.')) return await gitMethod(ctx, client, id, method, body);
        if (method === 'terminal.open') return await ctx.terminals.open(db, client, id, body);
        if (method.startsWith('terminal.')) return await ctx.terminals.method(client, id, method, body);
        if (method.startsWith('secret.')) return secretMethod(ctx, client, id, method, body);
        if (method.startsWith('checkpoint.')) return await checkpointMethod(ctx, client, id, method, body);
        if (method.startsWith('file.')) return await fileMethod(ctx, client, id, method, body);
        return client.link.replyError(id, 'protocol.unimplemented', method);
    }
  } catch (error) {
    return client.link.replyError(id, 'daemon.error', error instanceof Error ? error.message : String(error));
  }
}

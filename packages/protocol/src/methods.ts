import * as z from 'zod/mini';
import { cursorSchema, jsonObjectSchema, requestIdSchema, sessionIdSchema, idSchema, timestampSchema } from './schema.ts';
import { portBlock, serviceRequests, serviceResponses } from './service-contracts.ts';

const session = { session: sessionIdSchema };
const draftSession = z.union([sessionIdSchema, z.literal('home')]);
const nonEmpty = z.string().check(z.minLength(1));
const secretName = z.string().check(z.regex(/^[A-Z_][A-Z0-9_]*$/));
const count = z.number().check(z.int(), z.gte(0));
const limitSchema = z.number().check(z.int(), z.gte(1), z.lte(500));
const costBucket = { tokens: count, usd: z.nullable(z.number()), unpriced: count, estimate: z.boolean() };
const gitPath = z.object({ path: nonEmpty, oldPath: z.optional(nonEmpty), status: z.enum(['M', 'A', 'D', 'R', '?', 'U']), staged: z.boolean(), unstaged: z.boolean() });
const gitFileStat = z.object({ path: nonEmpty, oldPath: z.optional(nonEmpty), status: z.enum(['M', 'A', 'D', 'R', '?', 'U']), binary: z.boolean(), added: count, removed: count });
const stashItem = z.object({ index: count, ref: nonEmpty, message: z.string(), branch: z.nullable(z.string()), ts: timestampSchema, files: count, added: count, removed: count });
const branchInfo = z.object({
  current: z.nullable(z.string()),
  local: z.array(z.object({
    name: nonEmpty, sha: nonEmpty, subject: z.string(), ts: timestampSchema, upstream: z.nullable(z.string()),
    ahead: count, behind: count, current: z.boolean(), gone: z.boolean(), merged: z.boolean(), worktreePath: z.nullable(nonEmpty),
  })),
  remote: z.array(z.object({ name: nonEmpty, sha: nonEmpty, subject: z.string(), ts: timestampSchema })),
});
const gitLogResponse = z.object({
  commits: z.array(z.object({
    sha: nonEmpty, subject: z.string(), author: z.string(), email: z.string(), ts: timestampSchema,
    parents: z.array(nonEmpty), refs: z.array(z.string()), pushed: z.boolean(), session: z.optional(nonEmpty),
  })), total: count,
});
const fileEntry = z.object({
  name: nonEmpty, path: nonEmpty, kind: z.enum(['dir', 'file', 'symlink']), size: count, mtime: z.number(),
  git: z.optional(z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'ignored', 'conflicted'])),
});
const fileSearchResponse = z.union([
  z.object({ files: z.array(z.object({ path: nonEmpty, kind: z.optional(z.enum(['file', 'folder'])), score: z.number(), positions: z.array(count) })), truncated: z.boolean() }),
  z.object({ matches: z.array(z.object({ path: nonEmpty, line: count, text: z.string(), ranges: z.array(z.tuple([count, count])) })), truncated: z.boolean() }),
]);
const gitPr = z.object({
  number: count, title: z.string(), body: z.string(), state: z.enum(['open', 'closed', 'merged', 'draft']), url: nonEmpty,
  head: nonEmpty, base: nonEmpty, author: nonEmpty, createdAt: timestampSchema,
  checks: z.array(z.object({ name: z.string(), state: z.enum(['pass', 'fail', 'pending', 'skipped']), durationMs: z.nullable(count) })),
  reviewers: z.array(z.object({ login: nonEmpty, state: z.enum(['approved', 'changes_requested', 'commented', 'requested']) })),
  additions: count, deletions: count, changedFiles: count,
});
export const sessionStateSchema = z.enum([
  'idle', 'starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying',
  'paused_rate_limited', 'interrupted', 'failed', 'done', 'archived',
]);
const workspaceSchema = z.union([
  z.object({ kind: z.literal('current') }),
  z.object({ kind: z.literal('branch'), branch: nonEmpty, from: z.optional(nonEmpty) }),
  z.object({ kind: z.literal('checkout'), branch: nonEmpty }),
  z.object({
    kind: z.literal('worktree'), branch: nonEmpty, name: z.optional(nonEmpty), includeDirty: z.optional(z.boolean()),
    skipInclude: z.optional(z.boolean()), skipSetup: z.optional(z.boolean()),
  }),
  z.object({ kind: z.literal('existing'), path: nonEmpty }),
  z.object({ kind: z.literal('scratch') }),
]);
const terminalInfo = z.looseObject({ terminal: nonEmpty, cwd: nonEmpty, shell: nonEmpty, device: z.string(), openedAt: timestampSchema, pid: cursorSchema, exited: z.boolean(), code: z.nullable(z.number()), offset: cursorSchema });
const priceStatus = z.object({ version: z.nullable(z.string()), source: z.enum(['openrouter', 'cache', 'none']), fetchedAt: z.nullable(timestampSchema), models: cursorSchema, error: z.optional(z.string()) });
const summarySchema = z.object({
  id: sessionIdSchema, title: z.nullable(z.string()), state: sessionStateSchema,
  project: nonEmpty, vendor: nonEmpty, transport: nonEmpty, updatedAt: timestampSchema,
  branch: z.optional(z.nullable(z.string())),
  worktree: z.optional(z.boolean()),
  ports: z.optional(portBlock),
  diff: z.optional(z.nullable(z.object({ added: cursorSchema, removed: cursorSchema, files: cursorSchema }))),
});
const configOptionSchema = z.object({
  id: nonEmpty, category: z.optional(nonEmpty), type: z.optional(nonEmpty), name: z.optional(z.string()),
  current: z.optional(z.union([z.string(), z.boolean()])),
  choices: z.optional(z.array(z.object({ value: z.union([z.string(), z.boolean()]), name: z.optional(z.string()) }))),
});
const sessionModeSchema = z.object({ id: nonEmpty, name: z.string() });
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_MAX_BYTES = 25 * 1024 * 1024;
const imageSchema = z.object({
  data: nonEmpty, mimeType: nonEmpty, name: z.optional(nonEmpty), size: z.optional(count),
});
const promptContextSchema = z.object({
  kind: z.enum(['file', 'folder', 'diff', 'terminal', 'notes']),
  path: z.optional(nonEmpty), terminal: z.optional(nonEmpty),
});
export type PromptContext = z.infer<typeof promptContextSchema>;
const attachmentSchema = z.object({
  name: nonEmpty, mimeType: nonEmpty,
  data: z.string().check(z.minLength(1), z.maxLength(14 * 1024 * 1024)),
});
export type PromptAttachment = z.infer<typeof attachmentSchema>;
const attachmentsSchema = z.optional(z.array(attachmentSchema)
  .check(z.refine(items => items.reduce((total, item) => total + item.data.length, 0) <= 35_000_000)));
const contextSchema = z.optional(z.array(promptContextSchema));
const queuedPrompt = z.object({
  id: nonEmpty, text: nonEmpty, createdAt: timestampSchema, images: z.optional(count), error: z.optional(z.string()),
});
const detailsSchema = z.extend(summarySchema, {
  cwd: nonEmpty,
  scratchFiles: z.optional(count),
  model: z.nullable(z.string()), effort: z.nullable(z.string()), mode: z.optional(z.nullable(z.string())),
  // What actually ran: the agent's own session id for resume, its reported version,
  // and the negotiated ACP protocol version when the transport is acp.
  nativeId: z.optional(z.nullable(nonEmpty)), agentVersion: z.optional(z.nullable(z.string())),
  acpVersion: z.optional(z.nullable(z.union([z.literal(1), z.literal(2)]))),
  options: z.optional(z.array(configOptionSchema)), modes: z.optional(z.array(sessionModeSchema)),
  parent: z.optional(z.nullable(sessionIdSchema)),
});
const handoffTargetSchema = z.object({ vendor: z.optional(nonEmpty), transport: z.optional(nonEmpty), model: z.optional(nonEmpty), effort: z.optional(nonEmpty), branch: z.optional(nonEmpty) });
const handoffSchema = z.object({ ...session, to: handoffTargetSchema, mode: z.enum(['in_place', 'rehydrate', 'fork']), brief: z.optional(z.string()), reason: z.optional(z.string()), confirmed: z.optional(z.boolean()), agentApproval: z.optional(z.boolean()) });
const handoffEstimateSchema = z.object({ ...session, to: handoffTargetSchema, mode: z.enum(['in_place', 'rehydrate', 'fork']), brief: z.optional(z.string()) });

// A registered body schema does not expose the operation; the server must implement it separately.
export const requestBodies = {
  'daemon.status': z.object({}),
  'session.start': z.object({
    machine: idSchema('m'), project: nonEmpty, vendor: nonEmpty, transport: nonEmpty,
    model: nonEmpty, effort: nonEmpty, mode: nonEmpty, workspace: workspaceSchema,
    workspaceName: z.optional(nonEmpty), agentCommand: z.optional(nonEmpty),
    agentArgs: z.optional(z.array(z.string())),
    context: contextSchema, attachments: attachmentsSchema,
    // Which session started this one (ormi_start via the MCP server).
    parent: z.optional(sessionIdSchema),
  }),
  'session.get': z.object(session),
  'session.copyOut': z.object({ ...session, paths: z.array(nonEmpty).check(z.minLength(1), z.maxLength(100)), project: nonEmpty, dest: z.optional(z.string()), overwrite: z.optional(z.boolean()) }),
  'session.rename': z.object({ ...session, title: nonEmpty }),
  'session.export': z.object({ ...session, format: z.literal('markdown') }),
  'session.list': z.object({ archived: z.optional(z.boolean()) }),
  'session.prompt': z.object({ ...session, text: nonEmpty, images: z.optional(z.array(imageSchema)), context: contextSchema, attachments: attachmentsSchema }),
  'session.draft.get': z.object({ session: draftSession }),
  'session.draft.set': z.object({ session: draftSession, text: z.string().check(z.maxLength(1_000_000)) }),
  'session.commands': z.object({ session: sessionIdSchema }),
  'prompts.history': z.object({
    project: z.optional(nonEmpty), query: z.optional(z.string()),
    limit: z.optional(z.number().check(z.int(), z.gte(1), z.lte(100))),
  }),
  'session.steer': z.object({ ...session, text: nonEmpty, images: z.optional(z.array(imageSchema)), context: contextSchema, attachments: attachmentsSchema }),
  'session.queue.add': z.object({ ...session, text: nonEmpty, images: z.optional(z.array(imageSchema)), context: contextSchema, attachments: attachmentsSchema }),
  'session.queue.list': z.object(session),
  'session.queue.update': z.object({ ...session, id: nonEmpty, text: nonEmpty }),
  'session.queue.remove': z.object({ ...session, id: nonEmpty }),
  'session.queue.move': z.object({ ...session, id: nonEmpty, index: z.number().check(z.int(), z.gte(0), z.lte(1000)) }),
  'session.pause': z.object(session),
  'session.resume': z.object(session),
  'session.abort': z.object(session),
  'session.retry': z.object(session),
  'session.archive': z.object(session),
  'session.delete': z.object(session),
  // Hand this task to another agent/config; in_place adjusts the same session.
  'session.handoff': handoffSchema,
  'session.handoffEstimate': handoffEstimateSchema,
  'session.handoffBrief': z.object(session),
  'session.setModel': z.object({ ...session, model: nonEmpty }),
  'session.setEffort': z.object({ ...session, effort: nonEmpty }),
  'session.setMode': z.object({ ...session, mode: nonEmpty }),
  'session.setOption': z.object({ ...session, id: nonEmpty, value: z.union([z.string(), z.boolean()]) }),
  'session.getNotes': z.object(session),
  'session.setNotes': z.object({ ...session, id: z.optional(idSchema('n')), title: z.string(), body: z.string() }),
  'session.deleteNote': z.object({ ...session, id: idSchema('n') }),
  'session.subscribe': z.object({ ...session, after: z.optional(cursorSchema) }),
  'session.unsubscribe': z.object(session),
  'session.decide': z.object({ ...session, request: requestIdSchema, option: nonEmpty }),
  'session.answer': z.object({ ...session, request: requestIdSchema, answers: z.record(nonEmpty, nonEmpty) }),
  // Installed agent adapters: which vendor/transport pairs session.start accepts.
  'agents.list': z.object({}),
  'git.diff': z.object(session),
  'git.status': z.object(session),
  'git.stage': z.object({ ...session, paths: z.optional(z.array(nonEmpty)) }),
  'git.unstage': z.object({ ...session, paths: z.optional(z.array(nonEmpty)) }),
  'git.commit': z.object({ ...session, message: nonEmpty, amend: z.optional(z.boolean()) }),
  'git.push': z.object(session),
  'git.log': z.object({ ...session, ref: z.optional(nonEmpty), limit: z.optional(limitSchema), skip: z.optional(count) }),
  'git.show': z.object({ ...session, sha: nonEmpty }),
  'git.branches': z.object(session),
  'git.checkout': z.object({ ...session, branch: nonEmpty }),
  'git.createBranch': z.object({ ...session, name: nonEmpty, from: z.optional(nonEmpty), checkout: z.optional(z.boolean()) }),
  'git.deleteBranch': z.object({ ...session, name: nonEmpty, confirm: nonEmpty }),
  'git.merge': z.object({ ...session, branch: z.optional(nonEmpty), continue: z.optional(z.boolean()), abort: z.optional(z.boolean()) }),
  'git.cherryPick': z.object({ ...session, commits: z.optional(z.array(nonEmpty).check(z.minLength(1), z.maxLength(50))), continue: z.optional(z.boolean()), abort: z.optional(z.boolean()) }),
  'git.revert': z.object({ ...session, commits: z.optional(z.array(nonEmpty).check(z.minLength(1), z.maxLength(50))), continue: z.optional(z.boolean()), abort: z.optional(z.boolean()) }),
  'git.stash': z.object({
    ...session, op: z.enum(['list', 'show', 'push', 'pop', 'apply', 'drop']), index: z.optional(count),
    message: z.optional(z.string()), includeUntracked: z.optional(z.boolean()),
  }),
  'git.prStatus': z.object(session),
  'git.pr': z.object({ ...session, title: nonEmpty, body: z.string(), draft: z.optional(z.boolean()) }),
  'git.prMerge': z.object({ ...session, method: z.enum(['squash', 'merge', 'rebase']) }),
  'session.cost': z.object(session),
  'cost.totals': z.object({ since: z.optional(timestampSchema) }),
  'pricing.status': z.object({}),
  'pricing.refresh': z.object({}),
  'pricing.get': z.object({ model: nonEmpty }),
  'session.digest': z.object({ since: timestampSchema }),
  'secret.set': z.object({ name: z.string().check(z.regex(/^[A-Z_][A-Z0-9_]*$/)), value: nonEmpty, project: z.optional(nonEmpty) }),
  'secret.delete': z.object({ name: z.string().check(z.regex(/^[A-Z_][A-Z0-9_]*$/)), project: z.optional(nonEmpty) }),
  'secret.status': z.object({ project: nonEmpty }),
  'secret.list': z.object({ project: z.optional(nonEmpty) }),
  'terminal.open': z.object({ cwd: z.optional(nonEmpty), session: z.optional(sessionIdSchema), cols: z.optional(cursorSchema), rows: z.optional(cursorSchema), shell: z.optional(nonEmpty), args: z.optional(z.array(z.string())) }),
  'terminal.attach': z.object({ terminal: nonEmpty, from: z.optional(cursorSchema) }),
  'terminal.detach': z.object({ terminal: nonEmpty }),
  'terminal.write': z.object({ terminal: nonEmpty, data: z.string() }),
  'terminal.resize': z.object({ terminal: nonEmpty, cols: cursorSchema, rows: cursorSchema }),
  'terminal.close': z.object({ terminal: nonEmpty }),
  'terminal.list': z.object({}),
  ...serviceRequests,
  'checkpoint.list': z.object(session),
  // Without `to`: what `from` changed since the checkpoint before it.
  'checkpoint.diff': z.object({ ...session, from: nonEmpty, to: z.optional(nonEmpty) }),
  'checkpoint.restore': z.object({ ...session, id: nonEmpty, mode: z.enum(['files', 'conversation']) }),
  'checkpoint.fork': z.object({ ...session, id: nonEmpty, branch: z.optional(nonEmpty) }),
  'file.list': z.object({ ...session, path: z.optional(z.string()) }),
  'file.read': z.object({ ...session, path: nonEmpty, ref: z.optional(nonEmpty), force: z.optional(z.boolean()) }),
  'file.write': z.object({ ...session, path: nonEmpty, content: z.string(), baseMtime: z.optional(z.number()) }),
  'file.search': z.object({
    ...session, query: nonEmpty, mode: z.enum(['name', 'content']), regex: z.optional(z.boolean()),
    limit: z.optional(z.number().check(z.int(), z.gte(1), z.lte(1000))),
  }),
  'file.blame': z.object({ ...session, path: nonEmpty }),
  'file.history': z.object({ ...session, path: nonEmpty, limit: z.optional(limitSchema) }),
  'devices.list': z.object({}),
  'devices.rename': z.object({ device: nonEmpty, name: nonEmpty }),
  // confirm must equal the device name, so a revoke can't fire by accident.
  'devices.revoke': z.object({ device: nonEmpty, confirm: nonEmpty }),
  'models.list': z.object({ agent: z.optional(nonEmpty), transport: z.optional(nonEmpty), refresh: z.optional(z.boolean()) }),
  // Branch catalog for a project dir before a session exists (composer workspace picker).
  'project.branches': z.object({ project: nonEmpty }),
  'project.searchFiles': z.object({ project: nonEmpty, query: z.string(), limit: z.optional(z.number().check(z.int(), z.gte(1), z.lte(500))) }),
  'project.fetch': z.object({ project: nonEmpty }),
  'project.pull': z.object({ project: nonEmpty, branch: nonEmpty }),
  'project.renameBranch': z.object({ project: nonEmpty, from: nonEmpty, to: nonEmpty }),
  'project.deleteBranch': z.object({ project: nonEmpty, name: nonEmpty, confirm: nonEmpty, force: z.optional(z.boolean()) }),
  'pair.create': z.object({}),
  // A device exchanges a live code for a device token (raw token returned once).
  'pair.join': z.object({ code: nonEmpty, name: nonEmpty }),
} as const;

export const responseBodies = {
  'daemon.status': z.object({ version: nonEmpty, uptimeMs: cursorSchema, liveWorkers: cursorSchema, relay: z.enum(['connected', 'disconnected']), lastError: z.nullable(z.string()) }),
  'session.start': z.object({ session: sessionIdSchema }),
  'session.get': detailsSchema,
  'session.copyOut': z.object({ copied: z.array(z.object({ from: nonEmpty, to: nonEmpty })) }),
  'session.rename': z.object({ renamed: z.literal(true), title: nonEmpty }),
  'session.export': z.object({ text: z.string() }),
  'session.list': z.object({ sessions: z.array(summarySchema) }),
  ...serviceResponses,
  'session.prompt': z.object({ accepted: z.literal(true) }),
  'session.draft.get': z.object({ text: z.string() }),
  'session.draft.set': z.object({ saved: z.literal(true) }),
  'session.commands': z.object({ commands: z.array(z.object({ name: z.string(), description: z.string(), source: z.literal('agent') })) }),
  'prompts.history': z.object({ items: z.array(z.object({
    text: z.string(), createdAt: timestampSchema, session: sessionIdSchema, project: nonEmpty,
  })) }),
  'session.steer': z.object({ accepted: z.literal(true), queued: z.boolean() }),
  'session.queue.add': z.object({ id: nonEmpty }),
  'session.queue.list': z.object({ items: z.array(queuedPrompt) }),
  'session.queue.update': z.object({ updated: z.literal(true) }),
  'session.queue.remove': z.object({ removed: z.literal(true) }),
  'session.queue.move': z.object({ moved: z.literal(true) }),
  'session.pause': z.object({ paused: z.literal(true) }),
  'session.resume': z.object({ resumed: z.literal(true) }),
  'session.abort': z.object({ interrupted: z.literal(true) }),
  'session.retry': z.object({ accepted: z.literal(true) }),
  'session.archive': z.object({ archived: z.literal(true) }),
  'session.delete': z.object({ deleted: z.literal(true) }),
  'session.handoff': z.object({ session: sessionIdSchema, brief: z.string(), parent: sessionIdSchema }),
  'session.handoffEstimate': z.object({
    briefTokens: count, contextTokens: count, filesChanged: count, usd: z.nullable(z.number()),
    confirmUsd: z.number().check(z.gte(0)), confirmRequired: z.boolean(),
  }),
  'session.handoffBrief': z.object({ brief: z.string() }),
  'session.setModel': z.object({ updated: z.literal(true) }),
  'session.setEffort': z.object({ updated: z.literal(true) }),
  'session.setMode': z.object({ updated: z.literal(true) }),
  'session.setOption': z.object({ updated: z.literal(true) }),
  'session.getNotes': z.object({ notes: z.array(z.object({ id: idSchema('n'), title: z.string(), body: z.string(), updatedAt: timestampSchema })) }),
  'session.setNotes': z.object({ id: idSchema('n') }),
  'session.deleteNote': z.object({ deleted: z.literal(true) }),
  'session.subscribe': z.object({ subscribed: z.literal(true) }),
  'session.unsubscribe': z.object({ unsubscribed: z.literal(true) }),
  'session.decide': z.object({ decided: z.literal(true) }),
  'session.answer': z.object({ answered: z.literal(true) }),
  'secret.set': z.object({ ok: z.literal(true) }),
  'secret.delete': z.object({ ok: z.literal(true) }),
  'terminal.open': terminalInfo,
  'terminal.attach': terminalInfo,
  'terminal.detach': z.object({}),
  'terminal.write': z.object({}),
  'terminal.resize': z.object({}),
  'terminal.close': z.object({}),
  'terminal.list': z.object({ terminals: z.array(terminalInfo) }),
  'secret.status': z.object({ keyring: z.string(), declared: z.array(z.string()), missing: z.array(z.string()) }),
  'secret.list': z.object({
    keyring: z.string(), available: z.boolean(), message: z.optional(z.string()),
    secrets: z.array(z.object({ name: secretName, scope: z.enum(['project', 'machine']), declared: z.boolean(), missing: z.boolean() })),
  }),
  'checkpoint.list': z.object({ checkpoints: z.array(z.object({ id: nonEmpty, seq: cursorSchema, tool: z.string(), ts: timestampSchema })) }),
  'session.digest': z.object({ since: timestampSchema, computedAt: timestampSchema, entries: z.array(jsonObjectSchema) }),
  'pricing.status': priceStatus,
  'pricing.refresh': priceStatus,
  'pricing.get': z.object({ model: nonEmpty, version: z.nullable(z.string()), price: z.nullable(z.object({ input: z.number(), output: z.number(), cacheRead: z.optional(z.number()), cacheWrite: z.optional(z.number()) })) }),
  'models.list': z.object({
    models: z.array(z.object({
      agent: nonEmpty, transport: nonEmpty, id: nonEmpty, label: nonEmpty, efforts: z.array(z.string()),
      available: z.boolean(), reason: z.optional(z.string()), cachedAt: timestampSchema,
    })),
    errors: z.optional(z.array(z.object({ agent: nonEmpty, transport: nonEmpty, message: nonEmpty }))),
  }),
  'session.cost': z.object({
    input: cursorSchema, output: cursorSchema, cacheRead: cursorSchema, cacheWrite: cursorSchema, turns: cursorSchema,
    usd: z.nullable(z.number()), source: z.enum(['reported', 'estimate', 'none']), priceVersion: z.nullable(z.string()), model: z.nullable(z.string()),
  }),
  'cost.totals': z.object({
    total: z.object(costBucket),
    projects: z.array(z.object({ project: nonEmpty, ...costBucket })),
    days: z.array(z.object({ date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)), ...costBucket })),
    sessions: z.array(z.object({ session: sessionIdSchema, project: nonEmpty, ...costBucket })),
  }),
  'git.diff': z.object({
    files: z.array(z.object({ path: nonEmpty, oldPath: z.optional(nonEmpty), status: z.enum(['added', 'deleted', 'modified', 'renamed']), binary: z.boolean(), added: cursorSchema, removed: cursorSchema })),
    patch: z.string(), truncated: z.boolean(),
  }),
  'git.status': z.object({
    branch: z.nullable(z.string()), base: z.nullable(z.string()), upstream: z.nullable(z.string()), ahead: count, behind: count, aheadOfBase: count,
    files: z.array(gitPath), staged: z.object({ added: count, removed: count, files: count }),
  }),
  'git.stage': z.object({}),
  'git.unstage': z.object({}),
  'git.commit': z.object({ sha: nonEmpty }),
  'git.push': z.object({ branch: nonEmpty, upstream: nonEmpty }),
  'git.log': gitLogResponse,
  'git.show': z.object({
    sha: nonEmpty, subject: z.string(), body: z.string(), author: z.string(), ts: timestampSchema, parents: z.array(nonEmpty),
    files: z.array(gitFileStat), patch: z.string(), truncated: z.boolean(),
  }),
  'git.branches': branchInfo,
  'project.branches': z.object({
    isRepo: z.boolean(), detached: z.boolean(), dirty: count, busyBranches: z.array(nonEmpty),
    hasWorktreeInclude: z.boolean(), hasSetup: z.boolean(), fetchedAt: z.nullable(timestampSchema),
    defaultBranch: z.nullable(nonEmpty),
    worktrees: z.array(z.object({ path: nonEmpty, branch: z.nullable(z.string()), session: z.nullable(nonEmpty), state: z.nullable(z.string()), dirty: count })),
    ...branchInfo.shape,
  }),
  'project.searchFiles': z.object({
    files: z.array(z.object({ path: nonEmpty, kind: z.enum(['file', 'folder']), score: z.number(), positions: z.array(count) })),
    truncated: z.boolean(),
  }),
  'project.fetch': z.object({ ok: z.boolean(), error: z.optional(z.string()) }),
  'project.pull': z.object({ updated: z.boolean(), from: nonEmpty, to: nonEmpty }),
  'project.renameBranch': z.object({}),
  'project.deleteBranch': z.object({}),
  'git.checkout': z.object({ branch: nonEmpty }),
  'git.createBranch': z.object({ branch: nonEmpty }),
  'git.deleteBranch': z.object({}),
  'git.merge': z.object({ state: z.enum(['done', 'conflict']), head: z.optional(nonEmpty), conflict: z.optional(z.object({ files: z.array(nonEmpty) })) }),
  'git.cherryPick': z.object({ state: z.enum(['done', 'conflict']), head: z.optional(nonEmpty), conflict: z.optional(z.object({ files: z.array(nonEmpty) })) }),
  'git.revert': z.object({ state: z.enum(['done', 'conflict']), head: z.optional(nonEmpty), conflict: z.optional(z.object({ files: z.array(nonEmpty) })) }),
  'git.stash': z.union([
    z.object({ stashes: z.array(stashItem) }),
    z.object({ files: z.array(gitFileStat), patch: z.string(), truncated: z.boolean() }),
  ]),
  'git.prStatus': z.object({ pr: z.nullable(gitPr) }),
  'git.pr': z.object({ number: count, url: nonEmpty }),
  'git.prMerge': z.object({}),
  'checkpoint.diff': z.object({ patch: z.string(), truncated: z.boolean() }),
  'checkpoint.restore': z.object({ restored: z.literal(true), id: nonEmpty, mode: z.enum(['files', 'conversation']) }),
  'checkpoint.fork': z.object({ session: sessionIdSchema, branch: nonEmpty, cwd: nonEmpty, from: nonEmpty }),
  'file.list': z.object({ root: nonEmpty, path: z.string(), entries: z.array(fileEntry), free: z.nullable(z.number()) }),
  'file.read': z.object({
    path: nonEmpty, size: count, mtime: z.nullable(z.number()), binary: z.boolean(),
    mime: z.nullable(z.string()), encoding: z.nullable(z.enum(['utf8', 'base64'])),
    content: z.nullable(z.string()), tooLarge: z.boolean(),
  }),
  'file.write': z.object({ path: nonEmpty, size: count, mtime: z.number(), checkpoint: z.nullable(nonEmpty) }),
  'file.search': fileSearchResponse,
  'file.blame': z.object({
    hunks: z.array(z.object({ start: count, count, sha: nonEmpty })),
    commits: z.record(z.string(), z.object({ author: z.string(), ts: timestampSchema, summary: z.string(), session: z.optional(nonEmpty) })),
  }),
  'file.history': gitLogResponse,
  'agents.list': z.object({ agents: z.array(z.object({ vendor: nonEmpty, transports: z.array(nonEmpty) })) }),
  'devices.list': z.object({ devices: z.array(z.object({ id: nonEmpty, name: nonEmpty, trustedAt: timestampSchema })) }),
  'devices.rename': z.object({ renamed: z.literal(true) }),
  'devices.revoke': z.object({ revoked: z.literal(true), relaySynced: z.boolean() }),
  'pair.create': z.object({ code: nonEmpty, expiresAt: timestampSchema, link: nonEmpty }),
  'pair.join': z.object({ device: nonEmpty, token: nonEmpty }),
} as const;

export type ImplementedMethod = keyof typeof requestBodies;
export const methodNameSchema = z.string().check(z.regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/));
export const genericBodySchema = jsonObjectSchema;

function parseBody(registry: typeof requestBodies | typeof responseBodies, method: string, body: unknown) {
  if (!Object.hasOwn(registry, method)) return { success: false as const, error: 'protocol.unknown_method' as const };
  const result = z.safeParse(registry[method as ImplementedMethod], body);
  return result.success
    ? { success: true as const, data: result.data }
    : { success: false as const, error: 'protocol.invalid_frame' as const, issues: result.error.issues };
}
export function parseRequestBody(method: string, body: unknown) { return parseBody(requestBodies, method, body); }
export function parseResponseBody(method: string, body: unknown) { return parseBody(responseBodies, method, body); }

import * as z from 'zod/mini';
import { cursorSchema, jsonObjectSchema, requestIdSchema, sessionIdSchema, idSchema, timestampSchema } from './schema.ts';

const session = { session: sessionIdSchema };
const nonEmpty = z.string().check(z.minLength(1));
const count = z.number().check(z.int(), z.gte(0));
const limitSchema = z.number().check(z.int(), z.gte(1), z.lte(500));
const gitPath = z.object({ path: nonEmpty, oldPath: z.optional(nonEmpty), status: z.enum(['M', 'A', 'D', 'R', '?', 'U']), staged: z.boolean(), unstaged: z.boolean() });
const gitFileStat = z.object({ path: nonEmpty, oldPath: z.optional(nonEmpty), status: z.enum(['M', 'A', 'D', 'R', '?', 'U']), binary: z.boolean(), added: count, removed: count });
const stashItem = z.object({ index: count, ref: nonEmpty, message: z.string(), branch: z.nullable(z.string()), ts: timestampSchema, files: count, added: count, removed: count });
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
  z.object({ kind: z.literal('branch'), branch: nonEmpty }),
  z.object({ kind: z.literal('worktree'), branch: nonEmpty }),
  // No project folder: the session gets ~/.ormicode/scratch/<id> as its cwd.
  z.object({ kind: z.literal('scratch') }),
]);
const terminalInfo = z.looseObject({ terminal: nonEmpty, cwd: nonEmpty, shell: nonEmpty, device: z.string(), openedAt: timestampSchema, pid: cursorSchema, exited: z.boolean(), code: z.nullable(z.number()), offset: cursorSchema });
const priceStatus = z.object({ version: z.nullable(z.string()), source: z.enum(['openrouter', 'cache', 'none']), fetchedAt: z.nullable(timestampSchema), models: cursorSchema, error: z.optional(z.string()) });
const summarySchema = z.object({
  id: sessionIdSchema, title: z.nullable(z.string()), state: sessionStateSchema,
  project: nonEmpty, vendor: nonEmpty, transport: nonEmpty, updatedAt: timestampSchema,
  // Git branch the session works on; absent/null for scratch or no-git projects.
  branch: z.optional(z.nullable(z.string())),
  // Own worktree under .ormi/worktrees; diff = worktree vs base commit incl. untracked (null when git failed).
  worktree: z.optional(z.boolean()),
  diff: z.optional(z.nullable(z.object({ added: cursorSchema, removed: cursorSchema, files: cursorSchema }))),
});
const configOptionSchema = z.object({
  id: nonEmpty, category: z.optional(nonEmpty), type: z.optional(nonEmpty), name: z.optional(z.string()),
  current: z.optional(z.union([z.string(), z.boolean()])),
  choices: z.optional(z.array(z.object({ value: z.union([z.string(), z.boolean()]), name: z.optional(z.string()) }))),
});
const sessionModeSchema = z.object({ id: nonEmpty, name: z.string() });
const imageSchema = z.object({ data: nonEmpty, mimeType: nonEmpty });
const detailsSchema = z.extend(summarySchema, {
  model: z.nullable(z.string()), effort: z.nullable(z.string()), mode: z.optional(z.nullable(z.string())),
  // What actually ran: the agent's own session id for resume, its reported version,
  // and the negotiated ACP protocol version when the transport is acp.
  nativeId: z.optional(z.nullable(nonEmpty)), agentVersion: z.optional(z.nullable(z.string())),
  acpVersion: z.optional(z.nullable(z.union([z.literal(1), z.literal(2)]))),
  options: z.optional(z.array(configOptionSchema)), modes: z.optional(z.array(sessionModeSchema)),
  parent: z.optional(z.nullable(sessionIdSchema)),
});

// A registered body schema does not expose the operation; the server must implement it separately.
export const requestBodies = {
  'daemon.status': z.object({}),
  'session.start': z.object({
    machine: idSchema('m'), project: nonEmpty, vendor: nonEmpty, transport: nonEmpty,
    model: nonEmpty, effort: nonEmpty, mode: nonEmpty, workspace: workspaceSchema,
    workspaceName: z.optional(nonEmpty), agentCommand: z.optional(nonEmpty),
    agentArgs: z.optional(z.array(z.string())),
    // Which session started this one (ormi_start via the MCP server).
    parent: z.optional(sessionIdSchema),
  }),
  'session.get': z.object(session),
  'session.list': z.object({ archived: z.optional(z.boolean()) }),
  'session.prompt': z.object({ ...session, text: nonEmpty, images: z.optional(z.array(imageSchema)) }),
  'session.steer': z.object({ ...session, text: nonEmpty, images: z.optional(z.array(imageSchema)) }),
  'session.pause': z.object(session),
  'session.resume': z.object(session),
  'session.abort': z.object(session),
  'session.retry': z.object(session),
  'session.archive': z.object(session),
  'session.delete': z.object(session),
  // Hand this task to another agent/config. in_place changes model/effort on
  // the same session; rehydrate spawns a linked session with a brief; fork
  // is rehydrate on a new branch.
  'session.handoff': z.object({
    ...session,
    to: z.object({
      vendor: z.optional(nonEmpty), transport: z.optional(nonEmpty),
      model: z.optional(nonEmpty), effort: z.optional(nonEmpty), branch: z.optional(nonEmpty),
    }),
    mode: z.enum(['in_place', 'rehydrate', 'fork']),
    brief: z.optional(z.string()), reason: z.optional(z.string()),
  }),
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
  'pricing.status': z.object({}),
  'pricing.refresh': z.object({}),
  'pricing.get': z.object({ model: nonEmpty }),
  'session.digest': z.object({ since: timestampSchema }),
  'secret.set': z.object({ name: z.string().check(z.regex(/^[A-Z_][A-Z0-9_]*$/)), value: nonEmpty, project: z.optional(nonEmpty) }),
  'secret.delete': z.object({ name: z.string().check(z.regex(/^[A-Z_][A-Z0-9_]*$/)), project: z.optional(nonEmpty) }),
  'secret.status': z.object({ project: nonEmpty }),
  'terminal.open': z.object({ cwd: z.optional(nonEmpty), session: z.optional(sessionIdSchema), cols: z.optional(cursorSchema), rows: z.optional(cursorSchema), shell: z.optional(nonEmpty), args: z.optional(z.array(z.string())) }),
  'terminal.attach': z.object({ terminal: nonEmpty, from: z.optional(cursorSchema) }),
  'terminal.detach': z.object({ terminal: nonEmpty }),
  'terminal.write': z.object({ terminal: nonEmpty, data: z.string() }),
  'terminal.resize': z.object({ terminal: nonEmpty, cols: cursorSchema, rows: cursorSchema }),
  'terminal.close': z.object({ terminal: nonEmpty }),
  'terminal.list': z.object({}),
  'checkpoint.list': z.object(session),
  // Without `to`: what `from` changed since the checkpoint before it.
  'checkpoint.diff': z.object({ ...session, from: nonEmpty, to: z.optional(nonEmpty) }),
  'checkpoint.restore': z.object({ ...session, id: nonEmpty, mode: z.enum(['files', 'conversation']) }),
  'checkpoint.fork': z.object({ ...session, id: nonEmpty, branch: z.optional(nonEmpty) }),
  'devices.list': z.object({}),
  'devices.rename': z.object({ device: nonEmpty, name: nonEmpty }),
  // confirm must equal the device name, so a revoke can't fire by accident.
  'devices.revoke': z.object({ device: nonEmpty, confirm: nonEmpty }),
  // Hub-side pairing: returns a one-shot 12-digit code the new device enters.
  'pair.create': z.object({}),
  // A device exchanges a live code for a device token (raw token returned once).
  'pair.join': z.object({ code: nonEmpty, name: nonEmpty }),
} as const;

export const responseBodies = {
  'daemon.status': z.object({ version: nonEmpty, uptimeMs: cursorSchema, liveWorkers: cursorSchema, relay: z.enum(['connected', 'disconnected']), lastError: z.nullable(z.string()) }),
  'session.start': z.object({ session: sessionIdSchema }),
  'session.get': detailsSchema,
  'session.list': z.object({ sessions: z.array(summarySchema) }),
  'session.prompt': z.object({ accepted: z.literal(true) }),
  'session.steer': z.object({ accepted: z.literal(true), queued: z.boolean() }),
  'session.pause': z.object({ paused: z.literal(true) }),
  'session.resume': z.object({ resumed: z.literal(true) }),
  'session.abort': z.object({ interrupted: z.literal(true) }),
  'session.retry': z.object({ accepted: z.literal(true) }),
  'session.archive': z.object({ archived: z.literal(true) }),
  'session.delete': z.object({ deleted: z.literal(true) }),
  'session.handoff': z.object({ session: sessionIdSchema, brief: z.string(), parent: sessionIdSchema }),
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
  'checkpoint.list': z.object({ checkpoints: z.array(z.object({ id: nonEmpty, seq: cursorSchema, tool: z.string(), ts: timestampSchema })) }),
  'session.digest': z.object({ since: timestampSchema, computedAt: timestampSchema, entries: z.array(jsonObjectSchema) }),
  'pricing.status': priceStatus,
  'pricing.refresh': priceStatus,
  'pricing.get': z.object({ model: nonEmpty, version: z.nullable(z.string()), price: z.nullable(z.object({ input: z.number(), output: z.number(), cacheRead: z.optional(z.number()), cacheWrite: z.optional(z.number()) })) }),
  'session.cost': z.object({
    input: cursorSchema, output: cursorSchema, cacheRead: cursorSchema, cacheWrite: cursorSchema, turns: cursorSchema,
    usd: z.nullable(z.number()), source: z.enum(['reported', 'estimate', 'none']), priceVersion: z.nullable(z.string()), model: z.nullable(z.string()),
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
  'git.log': z.object({
    commits: z.array(z.object({
      sha: nonEmpty, subject: z.string(), author: z.string(), email: z.string(), ts: timestampSchema,
      parents: z.array(nonEmpty), refs: z.array(z.string()), pushed: z.boolean(), session: z.optional(nonEmpty),
    })), total: count,
  }),
  'git.show': z.object({
    sha: nonEmpty, subject: z.string(), body: z.string(), author: z.string(), ts: timestampSchema, parents: z.array(nonEmpty),
    files: z.array(gitFileStat), patch: z.string(), truncated: z.boolean(),
  }),
  'git.branches': z.object({
    current: z.nullable(z.string()),
    local: z.array(z.object({ name: nonEmpty, sha: nonEmpty, subject: z.string(), ts: timestampSchema, upstream: z.nullable(z.string()), ahead: count, behind: count, current: z.boolean(), gone: z.boolean() })),
    remote: z.array(z.object({ name: nonEmpty, sha: nonEmpty, subject: z.string(), ts: timestampSchema })),
  }),
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
  'checkpoint.restore': z.object({ restored: z.literal(true), id: nonEmpty }),
  'checkpoint.fork': z.object({ session: sessionIdSchema, branch: nonEmpty, cwd: nonEmpty, from: nonEmpty }),
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

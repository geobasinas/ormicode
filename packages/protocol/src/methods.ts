import * as z from 'zod/mini';
import { cursorSchema, jsonObjectSchema, requestIdSchema, sessionIdSchema, idSchema, timestampSchema } from './schema.ts';

const session = { session: sessionIdSchema };
const nonEmpty = z.string().check(z.minLength(1));
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
const summarySchema = z.object({
  id: sessionIdSchema, title: z.nullable(z.string()), state: sessionStateSchema,
  project: nonEmpty, vendor: nonEmpty, transport: nonEmpty, updatedAt: timestampSchema,
  // Git branch the session works on; absent/null for scratch or no-git projects.
  branch: z.optional(z.nullable(z.string())),
});
const configOptionSchema = z.object({
  id: nonEmpty, category: z.optional(nonEmpty), type: z.optional(nonEmpty), name: z.optional(z.string()),
  current: z.optional(z.union([z.string(), z.boolean()])),
  choices: z.optional(z.array(z.object({ value: z.union([z.string(), z.boolean()]), name: z.optional(z.string()) }))),
});
const sessionModeSchema = z.object({ id: nonEmpty, name: z.string() });
const imageSchema = z.object({ data: nonEmpty, mimeType: nonEmpty });
const detailsSchema = z.extend(summarySchema, {
  model: z.nullable(z.string()), effort: z.nullable(z.string()),
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

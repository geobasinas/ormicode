import * as z from 'zod/mini';
import { cursorSchema, sessionIdSchema, timestampSchema } from './schema.ts';

const count = z.number().check(z.int(), z.gte(0));
const nonEmpty = z.string().check(z.minLength(1));

export const portBlock = z.object({ base: count, count });
const serviceView = z.object({
  name: nonEmpty, state: z.enum(['stopped', 'starting', 'running', 'unhealthy', 'exited']), port: count,
  pid: z.optional(count), code: z.optional(z.nullable(z.number())), detail: z.optional(z.string()),
  startedAt: z.optional(timestampSchema), health: z.optional(z.string()),
  portals: z.array(z.object({ title: z.string(), path: z.string(), url: nonEmpty })),
});

export const serviceRequests = {
  'service.list': z.object({ session: sessionIdSchema }),
  'service.start': z.object({ session: sessionIdSchema, service: nonEmpty }),
  'service.stop': z.object({ session: sessionIdSchema, service: nonEmpty }),
  'service.restart': z.object({ session: sessionIdSchema, service: nonEmpty }),
  'service.logs': z.object({ session: sessionIdSchema, service: nonEmpty, after: z.optional(cursorSchema) }),
  'preview.url': z.object({ session: sessionIdSchema, port: count, path: z.optional(z.string()) }),
  'preview.fetch': z.object({
    session: sessionIdSchema, port: count, method: z.string().check(z.regex(/^[A-Za-z]{1,16}$/)),
    path: nonEmpty, headers: z.record(z.string(), z.string()), body: z.optional(z.string().check(z.maxLength(14 * 1024 * 1024))),
  }),
  'preview.fetchMore': z.object({ handle: nonEmpty }),
  'preview.console': z.object({ session: sessionIdSchema, after: z.optional(cursorSchema), limit: z.optional(count.check(z.gte(1), z.lte(500))) }),
  'preview.consoleClear': z.object({ session: sessionIdSchema }),
} as const;

export const previewConsoleEntry = z.object({
  id: nonEmpty, seq: count, ts: timestampSchema, port: count, path: z.string(),
  kind: z.enum(['console', 'error', 'rejection', 'network']), level: z.enum(['error', 'warn']),
  message: z.string(), stack: z.optional(z.string()), source: z.optional(z.string()),
  line: z.optional(count), col: z.optional(count), method: z.optional(z.string()), url: z.optional(z.string()),
  status: z.optional(count), durationMs: z.optional(count),
  requestBody: z.optional(z.string()), responseBody: z.optional(z.string()),
});
export type PreviewConsoleEntry = z.infer<typeof previewConsoleEntry>;

export const browserRequests = {
  'browser.status': z.object({}),
  'browser.settings': z.object({}),
  'browser.setSettings': z.object({ checkpointScreenshots: z.boolean(), uiCheck: z.boolean() }),
  'browser.install': z.object({}),
  'browser.open': z.object({
    ...{ session: sessionIdSchema }, port: z.optional(count), path: z.optional(z.string()), url: z.optional(nonEmpty),
    device: z.optional(z.enum(['phone', 'tablet', 'desktop'])),
  }),
  'browser.click': z.object({ session: sessionIdSchema, selector: nonEmpty }),
  'browser.type': z.object({ session: sessionIdSchema, selector: nonEmpty, text: z.string(), submit: z.optional(z.boolean()) }),
  'browser.snapshot': z.object({ session: sessionIdSchema }),
  'browser.screenshot': z.object({ session: sessionIdSchema, fullPage: z.optional(z.boolean()), selector: z.optional(nonEmpty) }),
  'browser.close': z.object({ session: sessionIdSchema }),
  'browser.artifact': z.object({
    session: sessionIdSchema, id: z.string().check(z.regex(/^bl_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)),
    offset: z.optional(count), length: z.optional(count.check(z.gte(1), z.lte(512 * 1024))),
  }),
  'browser.diff': z.object({
    session: sessionIdSchema,
    a: z.string().check(z.regex(/^bl_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)),
    b: z.string().check(z.regex(/^bl_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)),
  }),
} as const;

const browserActionResponse = z.object({
  url: z.string(), title: z.string(), consoleErrors: count, snapshot: z.optional(z.string()),
  artifact: z.optional(nonEmpty), jpeg: z.optional(nonEmpty), closed: z.optional(z.boolean()),
});
export const browserResponses = {
  'browser.status': z.object({ available: z.boolean(), source: z.nullable(z.enum(['env', 'installed', 'system'])), path: z.optional(nonEmpty) }),
  'browser.settings': z.object({ checkpointScreenshots: z.boolean(), uiCheck: z.boolean() }),
  'browser.setSettings': z.object({ checkpointScreenshots: z.boolean(), uiCheck: z.boolean() }),
  'browser.install': z.object({ installed: z.literal(true), path: nonEmpty }),
  'browser.open': browserActionResponse,
  'browser.click': browserActionResponse,
  'browser.type': browserActionResponse,
  'browser.snapshot': browserActionResponse,
  'browser.screenshot': browserActionResponse,
  'browser.close': browserActionResponse,
  'browser.artifact': z.object({ mime: nonEmpty, data: z.string(), size: count, offset: count, more: z.optional(z.boolean()) }),
  'browser.diff': z.object({ artifact: nonEmpty, changed: count, total: count, percent: z.number(), width: count, height: count }),
} as const;

export const serviceResponses = {
  'service.list': z.object({
    ports: portBlock, proxy: z.object({ port: count }),
    config: z.object({ found: z.boolean(), path: z.optional(z.string()), error: z.optional(z.string()) }),
    services: z.array(serviceView), detected: z.array(z.object({ port: count, url: nonEmpty })),
  }),
  'service.start': z.object({ service: serviceView }),
  'service.stop': z.object({ service: serviceView }),
  'service.restart': z.object({ service: serviceView }),
  'service.logs': z.object({ lines: z.array(z.object({ text: z.string(), stream: z.enum(['stdout', 'stderr']) })), next: count, truncated: z.boolean() }),
  'preview.url': z.object({ url: nonEmpty }),
  'preview.fetch': z.object({
    status: count, headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    body: z.string(), size: count, more: z.optional(nonEmpty),
  }),
  'preview.fetchMore': z.object({ body: z.string(), more: z.optional(nonEmpty) }),
  'preview.console': z.object({ entries: z.array(previewConsoleEntry), next: count, dropped: count }),
  'preview.consoleClear': z.object({ cleared: z.literal(true) }),
} as const;

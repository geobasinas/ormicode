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
  'service.logs': z.object({ lines: z.array(z.string()), next: count, truncated: z.boolean() }),
  'preview.url': z.object({ url: nonEmpty }),
} as const;

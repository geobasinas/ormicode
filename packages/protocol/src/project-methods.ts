import * as z from 'zod/mini';
import { timestampSchema } from './schema.ts';

const nonEmpty = z.string().check(z.minLength(1));
const machine = z.object({
  id: nonEmpty, name: nonEmpty, kind: z.enum(['local', 'node', 'boat']),
  status: z.enum(['online', 'degraded', 'offline']), heartbeat: z.nullable(timestampSchema), reason: z.optional(z.string()),
});
const project = z.object({ machine: nonEmpty, path: nonEmpty, name: nonEmpty, git: z.boolean(), addedAt: timestampSchema });
const browseEntry = z.object({ name: nonEmpty, path: nonEmpty, git: z.boolean(), hidden: z.boolean() });

export const projectRequests = {
  'machine.list': z.object({}),
  'fs.browse': z.object({ machine: nonEmpty, path: z.optional(z.string()), hidden: z.optional(z.boolean()) }),
  'project.list': z.object({}),
  'project.add': z.object({ machine: nonEmpty, path: nonEmpty }),
  'project.remove': z.object({ machine: nonEmpty, path: nonEmpty }),
} as const;

export const projectResponses = {
  'machine.list': z.object({ machines: z.array(machine) }),
  'fs.browse': z.object({
    machine: nonEmpty, path: nonEmpty, parent: z.nullable(z.string()), home: nonEmpty,
    entries: z.array(browseEntry), truncated: z.boolean(),
  }),
  'project.list': z.object({ projects: z.array(project) }),
  'project.add': z.object({ project }),
  'project.remove': z.object({ removed: z.boolean() }),
} as const;

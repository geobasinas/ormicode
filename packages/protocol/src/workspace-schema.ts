import * as z from 'zod/mini';

const nonEmpty = z.string().check(z.minLength(1));
export const workspaceSchema = z.union([
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

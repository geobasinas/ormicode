import * as z from 'zod/mini';

const count = z.number().check(z.int(), z.gte(0));
const nonEmpty = z.string().check(z.minLength(1));

/** Settings → Data and privacy: export the store as a tar, or wipe local data. Local socket clients only. */
export const dataRequests = {
  'data.export': z.object({}),
  'data.exportChunk': z.object({ handle: nonEmpty, offset: count }),
  'data.wipe': z.object({ confirm: z.string() }),
};

export const dataResponses = {
  'data.export': z.object({ handle: nonEmpty, size: count, name: nonEmpty, files: z.array(nonEmpty) }),
  'data.exportChunk': z.object({ data: z.string(), done: z.boolean() }),
  'data.wipe': z.object({ wiped: z.literal(true), removed: z.array(nonEmpty), kept: z.array(nonEmpty), leftover: z.optional(nonEmpty) }),
};

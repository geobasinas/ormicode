import * as z from 'zod/mini';
import { sessionIdSchema, timestampSchema } from './schema.ts';

export const DESIGN_ACTIVITY_LIMIT = 12;
export const designChangeFields = {
  revision: z.number().check(z.int(), z.gte(1)),
  originSession: z.optional(sessionIdSchema),
  source: z.optional(z.literal('mcp')),
  summary: z.optional(z.string().check(z.maxLength(120))),
};
export const designActivityItemSchema = z.object({ ...designChangeFields, at: timestampSchema });
export const designActivityResponseSchema = z.object({
  edits: z.array(designActivityItemSchema).check(z.maxLength(DESIGN_ACTIVITY_LIMIT)),
});
export type DesignActivityItem = z.infer<typeof designActivityItemSchema>;

import * as z from 'zod/mini';
import { sessionIdSchema } from './schema.ts';
import { designActivityResponseSchema } from './design-activity.ts';
export { DESIGN_ACTIVITY_LIMIT, type DesignActivityItem } from './design-activity.ts';
import { designPageSchema, designPageOperations } from './design-pages.ts';

export const DESIGN_DOCUMENT_BYTES = 96 * 1024;
export const DESIGN_STORAGE_BYTES = 224 * 1024;
export const DESIGN_HISTORY_LIMIT = 20;
const name = z.string().check(z.minLength(1), z.maxLength(120));
const id = z.string().check(z.regex(/^[a-zA-Z0-9_-]{1,80}$/));
export const designSlugSchema = z.string().check(z.regex(/^[a-z0-9][a-z0-9-]{0,47}$/));
const revision = z.number().check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER - 1));
const position = z.number().check(z.gte(-100000), z.lte(100000));
const dimension = z.number().check(z.gte(80), z.lte(4096));
const html = z.string().check(z.maxLength(24576));
const styles = z.string().check(z.maxLength(16384));
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const frameFields = { name, x: position, y: position, width: dimension, height: dimension, html, styles, pageId: z.optional(id) };
export const designFrameSchema = z.strictObject({ id, ...frameFields });
export const designCommentSchema = z.strictObject({
  id, frameId: z.nullable(id), element: z.optional(z.string().check(z.maxLength(240))),
  text: z.string().check(z.minLength(1), z.maxLength(2000)), resolved: z.boolean(),
  session: sessionIdSchema, createdAt: z.number().check(z.gte(0)),
});
export const designDocumentSchema = z.strictObject({
  version: z.literal(1), name, revision,
  pages: z.optional(z.array(designPageSchema).check(z.maxLength(24))),
  frames: z.array(designFrameSchema).check(z.maxLength(24)),
  workingFrameId: z.nullable(id), comments: z.array(designCommentSchema).check(z.maxLength(100)),
}).check(z.refine(document => encodedBytes(document) <= DESIGN_DOCUMENT_BYTES));
export const designHistorySummarySchema = z.strictObject({ revision, at: z.number().check(z.gte(0)), summary: name });
export const designStorageSchema = z.strictObject({
  document: designDocumentSchema,
  history: z.array(z.strictObject({ ...designHistorySummarySchema.shape, document: designDocumentSchema })).check(z.maxLength(DESIGN_HISTORY_LIMIT)),
}).check(z.refine(stored => encodedBytes(stored) <= DESIGN_STORAGE_BYTES));
export const designOperationSchema = z.union([
  ...designPageOperations,
  z.strictObject({ type: z.literal('frame.add'), ...frameFields }),
  z.strictObject({ type: z.literal('frame.update'), frameId: id, patch: z.partial(z.strictObject(frameFields)) }),
  z.strictObject({ type: z.literal('frame.remove'), frameId: id }),
  z.strictObject({ type: z.literal('frame.duplicate'), frameId: id }),
  z.strictObject({ type: z.literal('direction.select'), frameId: z.nullable(id) }),
  z.strictObject({ type: z.literal('board.rename'), name }),
  z.strictObject({ type: z.literal('comment.add'), frameId: z.nullable(id), element: z.optional(z.string().check(z.maxLength(240))), text: z.string().check(z.minLength(1), z.maxLength(2000)) }),
  z.strictObject({ type: z.literal('comment.resolve'), commentId: id, resolved: z.boolean() }),
  z.strictObject({ type: z.literal('comment.remove'), commentId: id }),
]);
const board = { session: sessionIdSchema, slug: designSlugSchema };
const history = z.array(designHistorySummarySchema).check(z.maxLength(DESIGN_HISTORY_LIMIT));
const result = z.object({ document: designDocumentSchema, history });
export const designRequests = {
  'design.list': z.object({ session: sessionIdSchema }),
  'design.get': z.object(board),
  'design.create': z.object({ ...board, name }),
  'design.update': z.object({ ...board, expectedRevision: revision, operations: z.array(designOperationSchema).check(z.minLength(1), z.maxLength(16)) }).check(z.refine(request => encodedBytes(request) <= 192 * 1024)),
  'design.history': z.object(board),
  'design.activity': z.object(board),
  'design.restore': z.object({ ...board, expectedRevision: revision, targetRevision: revision }),
};
export const designResponses = {
  'design.list': z.object({ boards: z.array(z.object({ slug: designSlugSchema, name, revision, frames: z.number().check(z.int(), z.gte(0), z.lte(24)) })).check(z.maxLength(100)) }),
  'design.get': result, 'design.create': result, 'design.update': result, 'design.restore': result,
  'design.history': z.object({ history }),
  'design.activity': designActivityResponseSchema,
};
export type DesignDocument = z.infer<typeof designDocumentSchema>;
export type DesignFrame = z.infer<typeof designFrameSchema>;
export type DesignOperation = z.infer<typeof designOperationSchema>;
export type DesignStorage = z.infer<typeof designStorageSchema>;
export type DesignHistorySummary = z.infer<typeof designHistorySummarySchema>;

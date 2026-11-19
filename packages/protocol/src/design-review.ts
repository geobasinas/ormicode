import * as z from 'zod/mini';
import { sessionIdSchema } from './schema.ts';

const id = z.string().check(z.regex(/^[a-zA-Z0-9_-]{1,80}$/));
const revision = z.number().check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER - 1));
const at = z.number().check(z.gte(0));
const text = z.string().check(z.minLength(1), z.maxLength(2000));
const coordinate = z.number().check(z.gte(-100000), z.lte(100000));
export const designActorSchema = z.strictObject({ kind: z.enum(['user', 'agent']), session: sessionIdSchema, device: z.optional(z.string().check(z.minLength(1), z.maxLength(80))) });
export const designPointSchema = z.strictObject({ x: coordinate, y: coordinate });
export const designPathSchema = z.string().check(z.regex(/^\d{1,5}(?:\.\d{1,5}){0,23}$/));
const mentions = z.array(sessionIdSchema).check(z.maxLength(8));
export const designReplySchema = z.strictObject({ id, text, author: designActorSchema, mentions: z.optional(mentions), createdAt: at });
export const designCommentInputFields = { pageId: z.optional(id), point: z.optional(designPointSchema), path: z.optional(designPathSchema), mentions: z.optional(mentions) };
export const designCommentReviewFields = {
  ...designCommentInputFields, author: z.optional(designActorSchema),
  replies: z.optional(z.array(designReplySchema).check(z.maxLength(50))),
  resolvedAt: z.optional(at), resolvedBy: z.optional(designActorSchema),
};
export const designContentHashSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/));
export const designFrameReviewFields = { approval: z.optional(z.strictObject({ status: z.enum(['approved', 'needs_review']), by: designActorSchema, at, revision, contentHash: designContentHashSchema })) };
export const designReviewOperations = [
  z.strictObject({ type: z.literal('comment.reply'), commentId: id, text, mentions: z.optional(mentions) }),
  z.strictObject({ type: z.literal('frame.approval'), frameId: id, status: z.enum(['approved', 'draft']) }),
  z.strictObject({ type: z.literal('frame.restoreVersion'), frameId: id, revision }),
] as const;
export const designReviewRequests = {
  'design.frameVersions': z.object({ session: sessionIdSchema, slug: z.string().check(z.regex(/^[a-z0-9][a-z0-9-]{0,47}$/)), frameId: id }),
  'design.mentionable': z.object({ session: sessionIdSchema }),
};
export const designReviewResponses = {
  'design.frameVersions': z.object({ versions: z.array(z.strictObject({ revision, at, summary: z.string().check(z.minLength(1), z.maxLength(120)), current: z.boolean(), html: z.string().check(z.maxLength(24576)), styles: z.string().check(z.maxLength(16384)), width: z.number().check(z.gte(80), z.lte(4096)), height: z.number().check(z.gte(80), z.lte(4096)), contentHash: designContentHashSchema })).check(z.maxLength(21)) }),
  'design.mentionable': z.object({ sessions: z.array(z.object({ id: sessionIdSchema, title: z.optional(z.string()), vendor: z.string() })).check(z.maxLength(100)) }),
};
export type DesignActor = z.infer<typeof designActorSchema>;

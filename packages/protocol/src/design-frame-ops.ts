import * as z from 'zod/mini';
import { sessionIdSchema } from './schema.ts';
import { designCommentReviewFields } from './design-review.ts';

// Frame-level layer state and named batch operations for selection, grouping,
// stacking, clipboard and undo/redo. Every field is optional so v1 boards and
// retained revisions written before these existed still parse unchanged.
export const DESIGN_FRAME_LIMIT = 24;
const id = z.string().check(z.regex(/^[a-zA-Z0-9_-]{1,80}$/));
const position = z.number().check(z.gte(-100000), z.lte(100000));
const dimension = z.number().check(z.gte(80), z.lte(4096));
const name = z.string().check(z.minLength(1), z.maxLength(120));
const html = z.string().check(z.maxLength(24576));
const styles = z.string().check(z.maxLength(16384));
const rotation = z.number().check(z.gte(-180), z.lte(180));
const frameIds = z.array(id).check(z.minLength(1), z.maxLength(DESIGN_FRAME_LIMIT));

/** Optional frame fields: absent means 0°, ungrouped, unlocked and visible. */
export const designFrameLayerFields = {
  rotation: z.optional(rotation), groupId: z.optional(id), locked: z.optional(z.boolean()), hidden: z.optional(z.boolean()),
};
const content = { name, x: position, y: position, width: dimension, height: dimension, html, styles, pageId: z.optional(id) };
/** A patch may clear layer state with null (or false/0, which normalize to absent). */
export const designFramePatchSchema = z.partial(z.strictObject({
  ...content, rotation, groupId: z.nullable(id), locked: z.boolean(), hidden: z.boolean(),
}));
const fullFrame = z.strictObject({ id, ...content, ...designFrameLayerFields });
const comment = z.strictObject({
  id, frameId: z.nullable(id), element: z.optional(z.string().check(z.maxLength(240))),
  text: z.string().check(z.minLength(1), z.maxLength(2000)), resolved: z.boolean(),
  session: sessionIdSchema, createdAt: z.number().check(z.gte(0)), ...designCommentReviewFields,
});

export const designFrameOperationSchemas = [
  /** Atomic batch move/resize/rotate/lock/hide/rename across frames. */
  z.strictObject({ type: z.literal('frames.set'), frames: z.array(z.strictObject({ frameId: id, patch: designFramePatchSchema })).check(z.minLength(1), z.maxLength(DESIGN_FRAME_LIMIT)) }),
  /** Remove several frames (and their comments) at once. */
  z.strictObject({ type: z.literal('frames.remove'), frameIds }),
  /** Reorder: the listed frames keep the stack slots they occupy, filled back to front in the given order. */
  z.strictObject({ type: z.literal('frames.order'), frameIds }),
  /** Move frames within the stack of their page relative to the other frames. */
  z.strictObject({ type: z.literal('frames.stack'), frameIds, to: z.enum(['front', 'back', 'forward', 'backward']) }),
  /** Give two or more frames one new group id; returns it via the frames. */
  z.strictObject({ type: z.literal('frames.group'), frameIds: z.array(id).check(z.minLength(2), z.maxLength(DESIGN_FRAME_LIMIT)) }),
  z.strictObject({ type: z.literal('frames.ungroup'), groupId: id }),
  /** Create copies with new ids; frames sharing a groupKey become one new group. */
  z.strictObject({ type: z.literal('frames.paste'), frames: z.array(z.strictObject({ ...content, rotation: z.optional(rotation), locked: z.optional(z.boolean()), hidden: z.optional(z.boolean()), groupKey: z.optional(id) })).check(z.minLength(1), z.maxLength(DESIGN_FRAME_LIMIT)) }),
  /** Re-insert removed frames with their original ids at stack indexes (undo/redo of delete or create). */
  z.strictObject({ type: z.literal('frames.restore'), frames: z.array(z.strictObject({ frame: fullFrame, index: z.number().check(z.int(), z.gte(0), z.lte(DESIGN_FRAME_LIMIT)) })).check(z.minLength(1), z.maxLength(DESIGN_FRAME_LIMIT)), comments: z.optional(z.array(comment).check(z.maxLength(100))) }),
] as const;

export type DesignFramePatch = z.infer<typeof designFramePatchSchema>;
export type DesignFrameOperation = z.infer<(typeof designFrameOperationSchemas)[number]>;
export type DesignStackDirection = 'front' | 'back' | 'forward' | 'backward';

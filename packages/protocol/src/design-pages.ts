import * as z from 'zod/mini';

const id = z.string().check(z.regex(/^[a-zA-Z0-9_-]{1,80}$/));
const name = z.string().check(z.minLength(1), z.maxLength(120));
const background = z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/));
const at = z.number().check(z.gte(-100000), z.lte(100000));
const axis = z.enum(['x', 'y']);
export const designPageSchema = z.strictObject({
  id, name, background: z.optional(background), startFrameId: z.optional(id),
  guides: z.optional(z.array(z.strictObject({ id, axis, at })).check(z.maxLength(40))),
});
export const designPageOperations = [
  z.strictObject({ type: z.literal('page.add'), name, background: z.optional(background) }),
  z.strictObject({ type: z.literal('page.rename'), pageId: id, name }),
  z.strictObject({ type: z.literal('page.move'), pageId: id, index: z.number().check(z.int(), z.gte(0)) }),
  z.strictObject({ type: z.literal('page.duplicate'), pageId: id }),
  z.strictObject({ type: z.literal('page.remove'), pageId: id }),
  z.strictObject({ type: z.literal('page.background'), pageId: id, background: z.nullable(background) }),
  z.strictObject({ type: z.literal('page.start'), pageId: id, frameId: z.nullable(id) }),
  z.strictObject({ type: z.literal('guide.add'), pageId: id, axis, at }),
  z.strictObject({ type: z.literal('guide.move'), pageId: id, guideId: id, at }),
  z.strictObject({ type: z.literal('guide.remove'), pageId: id, guideId: id }),
] as const;
export type DesignPage = z.infer<typeof designPageSchema>;

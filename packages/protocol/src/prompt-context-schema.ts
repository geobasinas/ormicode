import * as z from 'zod/mini';

const nonEmpty = z.string().check(z.minLength(1));

export const promptContextSchema = z.object({
  kind: z.enum(['file', 'folder', 'diff', 'terminal', 'notes', 'element', 'console']),
  path: z.optional(nonEmpty), terminal: z.optional(nonEmpty),
  element: z.optional(z.object({
    url: z.string().check(z.minLength(1), z.maxLength(2048)),
    selector: z.string().check(z.maxLength(2048)), html: z.string().check(z.maxLength(4096)),
    text: z.string().check(z.maxLength(300)),
    styles: z.record(z.string().check(z.maxLength(100)), z.string().check(z.maxLength(512)))
      .check(z.refine(styles => Object.keys(styles).length <= 20)),
    rect: z.object({
      x: z.number(), y: z.number(), width: z.number().check(z.gte(0)), height: z.number().check(z.gte(0)),
      devicePixelRatio: z.optional(z.number().check(z.positive())),
    }),
    component: z.optional(z.string().check(z.maxLength(200))), source: z.optional(z.string().check(z.maxLength(2048))),
    comment: z.optional(z.string().check(z.maxLength(1000))), index: z.optional(z.number().check(z.int(), z.gte(1))),
  })),
  console: z.optional(z.object({ ids: z.array(nonEmpty).check(z.maxLength(50)) })),
});

export type PromptContext = z.infer<typeof promptContextSchema>;

import * as z from 'zod/mini';
import { DESIGN_TOKEN_RULES, DESIGN_STYLE_VALUE_LIMIT, designTokenName, validateDesignTokenValue, type DesignTokenKind } from './design-inspector-style.ts';

export const DESIGN_TOKEN_LIMIT = 32;
export const designTokenSchema = z.strictObject({
  name: z.string().check(z.refine(designTokenName)),
  kind: z.enum(Object.keys(DESIGN_TOKEN_RULES) as DesignTokenKind[]),
  value: z.string().check(z.maxLength(DESIGN_STYLE_VALUE_LIMIT)),
}).check(z.refine(token => validateDesignTokenValue(token.kind, token.value)));

export const designTokensSchema = z.array(designTokenSchema)
  .check(z.maxLength(DESIGN_TOKEN_LIMIT), z.refine(tokens => new Set(tokens.map(token => token.name)).size === tokens.length));
export const designTokenSetSchema = z.strictObject({ type: z.literal('token.set'), token: designTokenSchema });
export type DesignToken = z.infer<typeof designTokenSchema>;

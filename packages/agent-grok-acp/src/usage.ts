import * as z from 'zod/mini';
import type { AgentEvent } from '@ormicode/protocol';

const counter = z.number().check(z.int(), z.gte(0));
const rowSchema = z.looseObject({ inputTokens: counter, outputTokens: counter, cachedReadTokens: z.optional(counter), cacheCreationTokens: z.optional(counter) });
const responseSchema = z.looseObject({ _meta: z.looseObject({ usage: z.looseObject({ modelUsage: z.optional(z.record(z.string(), z.unknown())) }) }) });

export function promptUsage(response: unknown): AgentEvent[] {
  const parsed = z.safeParse(responseSchema, response);
  if (!parsed.success) return [];
  const usage = parsed.data._meta.usage;
  const rows = usage.modelUsage && Object.keys(usage.modelUsage).length ? Object.entries(usage.modelUsage) : [[undefined, usage]] as const;
  return rows.flatMap(([model, value]) => {
    const parsedRow = z.safeParse(rowSchema, value);
    if (!parsedRow.success) return [];
    const row = parsedRow.data;
    const input = row.inputTokens - (row.cachedReadTokens ?? 0) - (row.cacheCreationTokens ?? 0);
    if (input < 0) return [];
    return [{ kind: 'usage' as const, ...(model ? { model } : {}), input, output: row.outputTokens,
      ...(row.cachedReadTokens !== undefined ? { cacheRead: row.cachedReadTokens } : {}),
      ...(row.cacheCreationTokens !== undefined ? { cacheWrite: row.cacheCreationTokens } : {}),
    }];
  });
}

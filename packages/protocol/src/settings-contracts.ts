import * as z from 'zod/mini';

const nonEmpty = z.string().check(z.minLength(1));
const settingValue = z.union([z.number(), z.string()]);
const settingEntry = z.object({
  key: nonEmpty, value: settingValue, default: settingValue, set: z.boolean(),
  min: z.optional(z.number()), max: z.optional(z.number()), choices: z.optional(z.array(nonEmpty)),
});

/** Account settings the hub reads live; `set` means a stored value overrides the default. */
export const settingsRequests = {
  'settings.get': z.object({}),
  // value null clears the stored value back to the default.
  'settings.set': z.object({ key: nonEmpty, value: z.union([settingValue, z.null()]) }),
};

export const settingsResponses = {
  'settings.get': z.object({ profile: z.enum(['laptop', 'vps']), settings: z.array(settingEntry) }),
  'settings.set': settingEntry,
};

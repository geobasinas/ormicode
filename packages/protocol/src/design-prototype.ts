export const DESIGN_PROTOTYPE_ATTRIBUTE = 'data-ormi-prototype';
export const DESIGN_PROTOTYPE_ACTION_PATTERN = '^(?:back|close-overlay|(?:frame|overlay):[a-zA-Z0-9_-]{1,80})$';
const actionPattern = new RegExp(DESIGN_PROTOTYPE_ACTION_PATTERN);

export type DesignPrototypeAction = 'back' | 'close-overlay' | `${'frame' | 'overlay'}:${string}`;

export function isDesignPrototypeAction(value: unknown): value is DesignPrototypeAction {
  return typeof value === 'string' && actionPattern.test(value);
}

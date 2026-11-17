/**
 * Layout descriptor: a versioned JSON per device that orders, sizes,
 * collapses and shows/hides surfaces. Client-only — never on the wire.
 * The approval surface can move and collapse but can never be hidden,
 * covered or pushed off-screen; a layout that breaks the rules is
 * rejected whole.
 */

export const REGION_IDS = ['sidebar', 'main', 'composer', 'rightRail', 'now.widgets', 'session.panel', 'approval'] as const;
export type RegionId = typeof REGION_IDS[number];

export interface RegionState { order: number; size?: number; collapsed?: boolean; visible?: boolean }
export interface LayoutDescriptor { version: 1; regions: Partial<Record<RegionId, RegionState>>; source?: 'user' | string }

export const defaultLayout: LayoutDescriptor = {
  version: 1,
  regions: {
    sidebar: { order: 0, size: 268 },
    main: { order: 1 },
    composer: { order: 2 },
    rightRail: { order: 3, collapsed: true },
    'now.widgets': { order: 0 },
    'session.panel': { order: 0 },
    approval: { order: 0 },
  },
};

export interface LayoutValidation { ok: boolean; errors: string[]; unknown: string[] }

/** Validate an incoming descriptor. Unknown ids are kept but reported. */
export function validateLayout(input: unknown): LayoutValidation {
  const errors: string[] = []; const unknown: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['layout is not an object'], unknown };
  const d = input as LayoutDescriptor;
  if (d.version !== 1) errors.push(`unsupported layout version ${String(d.version)}`);
  const regions = d.regions ?? {};
  for (const [id, region] of Object.entries(regions)) {
    if (!REGION_IDS.includes(id as RegionId)) { unknown.push(id); continue; }
    if (typeof region !== 'object' || region === null) { errors.push(`region ${id} is not an object`); continue; }
    if (typeof region.order !== 'number') errors.push(`region ${id}: order must be a number`);
    if (region.size !== undefined && (typeof region.size !== 'number' || region.size <= 0))
      errors.push(`region ${id}: size must be a positive number`);
  }
  const approval = regions.approval;
  if (approval?.visible === false) errors.push('approval surface cannot be hidden');
  if (approval?.size !== undefined && approval.size < 48) errors.push('approval surface cannot be smaller than 48px');
  return { ok: errors.length === 0, errors, unknown };
}

/** Merge a validated descriptor over the defaults (per-device file may be partial). */
export function applyLayout(base: LayoutDescriptor, patch: LayoutDescriptor): LayoutDescriptor {
  const regions = { ...base.regions };
  for (const [id, r] of Object.entries(patch.regions)) {
    if (REGION_IDS.includes(id as RegionId)) regions[id as RegionId] = { ...regions[id as RegionId], ...r };
  }
  return { version: 1, regions, ...(patch.source !== undefined ? { source: patch.source } : {}) };
}

/** Settings-only formatting: durations and byte sizes. */
export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${r}m` : `${r}m`;
}
export function bytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const gb = n / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${Math.round(n / 1e6)} MB`;
}
export const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

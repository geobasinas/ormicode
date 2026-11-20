/** Small formatting helpers shared across features. */

/** Relative age like `now`, `12m`, `3h`, `2d`. */
export function ago(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const milliseconds = ts < 1e12 ? ts * 1000 : ts;
  const s = Math.max(0, Math.floor((now - milliseconds) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** `12m ago`, or `just now` under a minute. */
export function agoText(ts: number, now = Date.now()): string {
  const a = ago(ts, now);
  if (!a) return '';
  return a === 'now' ? 'just now' : `${a} ago`;
}

/** Display name for a project path — basename for paths, as-is otherwise. */
export function projectName(project: string): string {
  const trimmed = project.replace(/[\\/]+$/, '');
  const base = trimmed.split(/[\\/]/).filter(Boolean).pop();
  return base || project;
}

export function compactTokens(tokens: number): string {
  const abs = Math.abs(tokens);
  if (abs < 1_000) return Math.round(tokens).toLocaleString('en-US');
  const unit = abs >= 1_000_000 ? 'm' : 'k';
  const value = abs >= 1_000_000 ? tokens / 1_000_000 : tokens / 1_000;
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1).replace(/\.0$/, '')}${unit}`;
}

export function formatUsd(usd: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(usd) < 0.01 ? 6 : 2,
  }).format(usd);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

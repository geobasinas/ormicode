/** A numeric hub setting: edit, save on Enter/blur, reset to default. `scale` converts stored units (ms) to shown units (minutes). */
import { useEffect, useState } from 'react';
import { Input } from '../../components/ui/input.tsx';
import type { HubSetting } from './useHubSettings.ts';

export function NumberSetting({ setting, unit, scale = 1, step = 1, label, onSave }: {
  setting?: HubSetting; unit?: string; scale?: number; step?: number; label: string;
  onSave(value: number | null): Promise<boolean>;
}) {
  const shown = (v: number | string | undefined) => typeof v === 'number' ? String(Math.round(v / scale * 100) / 100) : '';
  const [text, setText] = useState(shown(setting?.value));
  useEffect(() => { setText(shown(setting?.value)); }, [setting?.value]);
  const min = setting?.min !== undefined ? setting.min / scale : undefined;
  const max = setting?.max !== undefined ? setting.max / scale : undefined;
  const parsed = Number(text);
  const invalid = text.trim() === '' || !Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max);
  const commit = async () => {
    if (!setting || invalid) { setText(shown(setting?.value)); return; }
    const value = Math.round(parsed * scale * 100) / 100;
    if (value === setting.value) return;
    if (!await onSave(value)) setText(shown(setting.value));
  };
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    {setting?.set ? <button type="button" className="hv-sub" onClick={() => void onSave(null)} title={`Reset to ${shown(setting.default)}${unit ? ` ${unit}` : ''}`}
      style={{ font: 'inherit', fontSize: 11.5, color: 'var(--text-secondary)', background: 'transparent', border: 'none', borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>Reset</button> : null}
    <Input aria-label={label} aria-invalid={invalid || undefined} type="number" inputMode="decimal" min={min} max={max} step={step} value={text} disabled={!setting}
      title={min !== undefined ? `${min}–${max}${unit ? ` ${unit}` : ''}` : undefined}
      onChange={e => setText(e.target.value)} onBlur={() => void commit()}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(shown(setting?.value)); e.currentTarget.blur(); } }}
      style={{ width: 76, height: 28, fontSize: 12.5, textAlign: 'right', color: 'var(--text-title)', background: 'var(--bg-inset)' }} />
    <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 44 }}>{unit}</span>
  </span>;
}

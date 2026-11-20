export function SettingsSwitch({ on, onChange, disabled, ariaLabel }: {
  on: boolean; onChange?: (value: boolean) => void; disabled?: boolean; ariaLabel?: string;
}) {
  return <button type="button" role="switch" aria-label={ariaLabel} aria-checked={on} disabled={disabled} onClick={() => onChange?.(!on)} style={{
    width: 30, height: 17, borderRadius: 999, border: 'none', padding: 2, flexShrink: 0, cursor: disabled ? 'default' : 'pointer',
    background: on ? 'var(--bg-selected)' : 'var(--bg-raised)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
  }}><span style={{ width: 13, height: 13, borderRadius: 999, background: on ? 'var(--bg-main)' : 'var(--text-hint)' }} /></button>;
}

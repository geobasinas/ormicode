import { ShieldAlert } from 'lucide-react';

const policy = 'OpenCode runs with its own permission policy. Edits and shell commands may run without an Ormicode approval card. Deny blocks only a request OpenCode sends.';

export function OpenCodePermissionNotice({ vendor, transport, compact = false }: { vendor?: string; transport?: string; compact?: boolean }) {
  if (vendor !== 'opencode' || transport !== 'acp') return null;
  return <span role="note" aria-label="OpenCode ACP permission policy" title={policy} style={{
    display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 10 : 11, lineHeight: 1.3,
    color: 'var(--accent-amber)', padding: compact ? '0 4px' : '6px 8px',
    maxWidth: compact ? 210 : 260, minWidth: compact ? 120 : undefined,
  }}>
    <ShieldAlert size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
    <span>{compact ? 'OpenCode may write without approval' : policy}</span>
  </span>;
}

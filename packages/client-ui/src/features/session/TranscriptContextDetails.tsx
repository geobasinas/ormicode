import { contextChipLabel } from './composer-parts.tsx';
import type { PromptContext } from '@ormicode/protocol';

export function TranscriptContextDetails({ contexts }: { contexts: PromptContext[] }) {
  return <details style={{ marginTop: 7, border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 10.5 }}>
    <summary className="hv-sub" style={{ padding: '5px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--text-label)' }}>Context details</summary>
    <div style={{ display: 'grid', gap: 7, padding: '0 7px 7px' }}>
      {contexts.map((entry, index) => <div key={`${entry.kind}-${index}`} style={{ minWidth: 0 }}>
        <div style={{ marginBottom: 3, color: 'var(--text-hint)' }}>{contextChipLabel(entry)}</div>
        <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>
          {entry.kind === 'element' ? JSON.stringify(entry.element, null, 2) : `Console entries: ${entry.console?.ids.join(', ') ?? 'none'}`}
        </pre>
      </div>)}
    </div>
  </details>;
}

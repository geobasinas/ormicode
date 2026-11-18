/** Patch rendering: per-file header, hunk header, old/new line numbers,
 *  tinted added/removed lines (mockup diff block). */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { parsePatch, type FilePatch } from '@ormicode/diff';
import { mono, hint } from './parts.tsx';

function Hunks({ file }: { file: FilePatch }) {
  if (file.binary) return <div style={{ ...hint, padding: '6px 12px' }}>binary file</div>;
  return <>{file.hunks.map((h, hi) => {
    let o = h.oldStart; let n = h.newStart;
    return (
      <div key={hi}>
        <div style={{ ...mono, ...hint, fontSize: 10.5, padding: '4px 12px', background: 'var(--bg-inset)' }}>{h.header}</div>
        {h.lines.map((l, li) => {
          const c = l[0]; const num = c === '-' ? o++ : c === '+' ? n++ : (o++, n++);
          if (c === '\\') return null;
          return (
            <div key={li} style={{ ...mono, fontSize: 11, lineHeight: '19px', display: 'flex', whiteSpace: 'pre', background: c === '+' ? 'var(--tint-mint)' : c === '-' ? 'var(--tint-red)' : 'transparent' }}>
              <span style={{ width: 40, textAlign: 'right', paddingRight: 8, color: 'var(--text-hint)', flexShrink: 0 }}>{num}</span>
              <span style={{ width: 14, color: c === '+' ? 'var(--accent-mint)' : c === '-' ? 'var(--accent-red)' : 'transparent', flexShrink: 0 }}>{c === ' ' ? '' : c}</span>
              <span style={{ color: c === '+' ? '#bfe0cd' : c === '-' ? '#d9b1ad' : 'var(--text-label)' }}>{l.slice(1)}</span>
            </div>
          );
        })}
      </div>
    );
  })}</>;
}

export function DiffView({ patch, only, truncated }: { patch: string; only?: string; truncated?: boolean }) {
  const files = parsePatch(patch).filter(f => !only || f.path === only);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!files.length) return <div style={{ ...hint, padding: '8px 12px' }}>No diff</div>;
  return (
    <div>
      {files.map(f => (
        <div key={f.path}>
          <div onClick={() => setClosed(c => ({ ...c, [f.path]: !c[f.path] }))} style={{ ...mono, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid var(--line-subtle)' }}>
            {closed[f.path] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{f.path}
          </div>
          {closed[f.path] ? null : <Hunks file={f} />}
        </div>
      ))}
      {truncated ? <div style={{ ...hint, padding: '8px 12px' }}>Diff truncated at 256 KB</div> : null}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { requestOpenFile } from '../../lib/openFile.ts';
import type { TranscriptEvent } from './useTranscript.ts';

const countLines = (value: unknown) => typeof value === 'string' && value.length ? value.replace(/\n$/, '').split('\n').length : 0;
const str = (value: unknown) => typeof value === 'string' ? value : '';

export function ChangedFilesCard({ session, events, allowDiff = true }: { session: string; events: TranscriptEvent[]; allowDiff?: boolean }) {
  const [open, setOpen] = useState(false);
  const files = useMemo(() => {
    const changed = new Map<string, { path: string; added: number; removed: number }>();
    for (const event of events) {
      if (event.kind !== 'tool_call') continue;
      const name = String(event.body.name ?? '').toLowerCase();
      if (!['edit', 'multiedit', 'write', 'notebookedit', 'str_replace_based_edit_tool'].includes(name)) continue;
      const input = (event.body.input && typeof event.body.input === 'object' ? event.body.input : {}) as Record<string, unknown>;
      const path = str(input.file_path ?? input.filePath ?? input.path ?? input.notebook_path);
      if (!path) continue;
      const row = changed.get(path) ?? { path, added: 0, removed: 0 };
      const edits = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [input];
      if (name === 'write') row.added += countLines(input.content);
      else for (const edit of edits) {
        row.added += countLines(edit.new_string ?? edit.newString);
        row.removed += countLines(edit.old_string ?? edit.oldString);
      }
      changed.set(path, row);
    }
    return [...changed.values()];
  }, [events]);
  if (!files.length) return null;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return <div style={{ margin: '4px 0', color: 'var(--text-hint)', fontSize: 11 }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, padding: '2px 0', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      Changed {files.length} {files.length === 1 ? 'file' : 'files'}
      {added ? <span style={{ color: 'var(--accent-mint)' }}>+{added}</span> : null}
      {removed ? <span style={{ color: 'var(--accent-red)' }}>−{removed}</span> : null}
    </button>
    {open ? <div style={{ display: 'grid', gap: 2, margin: '3px 0 0 17px' }}>
      {files.map(file => <button key={file.path} type="button" onClick={() => requestOpenFile(session, file.path, allowDiff)} title={`Open ${file.path}${allowDiff ? ' diff' : ''} in Files`} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, border: 0, padding: '2px 0', background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        <FileText size={11} style={{ flexShrink: 0 }} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path}</span>
        {file.added ? <span style={{ color: 'var(--accent-mint)' }}>+{file.added}</span> : null}{file.removed ? <span style={{ color: 'var(--accent-red)' }}>−{file.removed}</span> : null}
      </button>)}
    </div> : null}
  </div>;
}

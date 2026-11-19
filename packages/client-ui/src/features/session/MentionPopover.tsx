import { useEffect, useRef } from 'react';
import { FileText, Folder, GitBranch, Terminal } from 'lucide-react';
import type { PromptContext } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';

export type MentionItem = { label: string; context: PromptContext; group: 'context' | 'files'; hint?: string };

export function MentionPopover({
  open, query, project, session, position, items, selectedIndex, onItemsChange, onPick,
}: {
  open: boolean;
  query: string;
  project?: string;
  session: string;
  position: { left: number; bottom: number };
  items: MentionItem[];
  selectedIndex: number;
  onItemsChange: (items: MentionItem[]) => void;
  onPick: (item: MentionItem) => void;
}) {
  const { transport } = usePlatform();
  const requestId = useRef(0);
  useEffect(() => {
    if (!open) {
      requestId.current++;
      onItemsChange([]);
      return;
    }
    const currentRequest = ++requestId.current;
    const contextItems: MentionItem[] = [
      { label: 'Diff', context: { kind: 'diff' }, group: 'context', hint: 'uncommitted changes' },
      { label: 'Terminal', context: { kind: 'terminal' }, group: 'context', hint: 'latest output' },
      { label: 'Notes', context: { kind: 'notes' }, group: 'context', hint: 'session notes' },
    ];
    onItemsChange(contextItems);
    const timer = window.setTimeout(() => {
      const search = async () => {
        const searchQuery = query || (project ? '' : 'a');
        const res = await transport.request(project ? 'project.searchFiles' : 'file.search', project
          ? { project, query: searchQuery, limit: 100 }
          : { session, query: searchQuery, mode: 'name', limit: 100 }).catch(() => undefined);
        if (currentRequest !== requestId.current) return;
        const body = res?.type === 'res' ? res.body as { files?: { path: string; kind?: 'file' | 'folder' }[] } : undefined;
        const files: MentionItem[] = (body?.files ?? []).map(file => ({
          label: file.path,
          context: { kind: file.kind ?? 'file', path: file.path },
          group: 'files',
        }));
        onItemsChange([...contextItems, ...files].slice(0, 100));
      };
      void search();
    }, 80);
    return () => {
      window.clearTimeout(timer);
      if (requestId.current === currentRequest) requestId.current++;
    };
  }, [open, onItemsChange, project, query, session, transport]);

  if (!open) return null;
  const row = (item: MentionItem) => {
    const index = items.indexOf(item);
    const path = item.context.path;
    if (!path) {
      const Icon = item.context.kind === 'diff' ? GitBranch : item.context.kind === 'terminal' ? Terminal : FileText;
      return <button key={`${item.context.kind}-${item.label}`} onMouseDown={event => event.preventDefault()} onClick={() => onPick(item)} style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 5, background: index === selectedIndex ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', textAlign: 'left', padding: '0 7px', fontSize: 11, cursor: 'pointer' }}>
        <Icon size={13} style={{ flexShrink: 0, color: 'var(--text-hint)' }} />
        <span>{item.label}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-hint)', fontSize: 10 }}>{item.hint}</span>
      </button>;
    }
    const folder = item.context.kind === 'folder';
    const name = path.split('/').at(-1) || path;
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return <button key={`${item.context.kind}-${item.label}`} onMouseDown={event => event.preventDefault()} onClick={() => onPick(item)} title={path} style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 5, background: index === selectedIndex ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', textAlign: 'left', padding: '0 7px', fontSize: 11, cursor: 'pointer', minWidth: 0 }}>
      {folder ? <Folder size={13} style={{ flexShrink: 0, color: 'var(--text-hint)' }} /> : <FileText size={13} style={{ flexShrink: 0, color: 'var(--text-hint)' }} />}
      <span style={{ whiteSpace: 'nowrap' }}>{name}{folder ? '/' : ''}</span>
      {parent ? <span title={parent} style={{ marginLeft: 'auto', maxWidth: 112, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'right', color: 'var(--text-hint)', fontSize: 10 }}>{parent}</span> : null}
    </button>;
  };

  return (
    <div style={{ position: 'absolute', left: position.left, bottom: position.bottom, width: 280, maxHeight: 240, overflowY: 'auto', zIndex: 20, background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 8, boxShadow: 'var(--shadow-md)', padding: 4 }}>
      <div style={{ padding: '3px 7px 2px', color: 'var(--text-hint)', fontSize: 9 }}>Context</div>
      {items.filter(item => item.group === 'context').map(row)}
      {items.some(item => item.group === 'files') ? <>
        <div style={{ padding: '5px 7px 2px', color: 'var(--text-hint)', fontSize: 9 }}>Files</div>
        {items.filter(item => item.group === 'files').map(row)}
      </> : null}
    </div>
  );
}

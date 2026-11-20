import type { ReactNode } from 'react';
import { ChevronDown, PanelRight, PanelsTopLeft, Plus, RefreshCw, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';

type Props = {
  boards: { slug: string; name: string }[]; name?: string; slug: string;
  status: string; failure: boolean; error: string; canReload: boolean;
  loading: boolean; saving: boolean; sourceDirty: boolean; inspectorOpen: boolean; createOpen: boolean;
  newName: string; newSlug: string; insertFrame: ReactNode;
  readBoard(slug: string): void; reloadCurrent(): void; toggleInspector(): void; createBoard(): void;
  setCreateOpen(value: boolean): void; setError(value: string): void; setNewName(value: string): void; setNewSlug(value: string): void;
};

export function DesignBoardHeader({ boards, name, slug, status, failure, error, canReload, loading, saving, sourceDirty,
  inspectorOpen, createOpen, newName, newSlug, insertFrame, readBoard, reloadCurrent, toggleInspector, createBoard,
  setCreateOpen, setError, setNewName, setNewSlug }: Props) {
  return <>
    <header className="design-canvas-header">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="design-board-picker" aria-label="Design board"><PanelsTopLeft size={16} /><strong>{name ?? boards.find(item => item.slug === slug)?.name ?? 'Boards'}</strong><ChevronDown size={13} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {boards.map(item => <DropdownMenuItem key={item.slug} onSelect={() => { if (item.slug !== slug) void readBoard(item.slug); }}>{item.name}</DropdownMenuItem>)}
          {boards.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}><Plus size={15} /> New board</DropdownMenuItem>
          {slug ? <DropdownMenuItem disabled={loading || saving || sourceDirty} onSelect={() => void reloadCurrent()}><RefreshCw size={14} /> Reload board</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="design-header-space" />
      {name && !failure ? <span className="design-status" data-dirty={sourceDirty || saving} role="status"><i />{status}</span> : null}
      {name ? insertFrame : null}
      <button type="button" className="design-icon-button design-inspector-toggle" title="Toggle inspector" aria-label="Toggle inspector" aria-expanded={inspectorOpen} onClick={() => toggleInspector()}><PanelRight size={17} /></button>
    </header>
    {failure ? <div className="design-alert" role="alert"><span>{status}</span>
      {canReload ? <button className="design-button" type="button" onClick={() => void reloadCurrent()}>Reload changes</button> : null}
      {error ? <button type="button" className="design-icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={14} /></button> : null}
    </div> : null}
    {createOpen ? <form className="design-create" onSubmit={event => { event.preventDefault(); void createBoard(); }}>
      <input className="design-input" aria-label="New board name" placeholder="Board name" autoFocus maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} />
      <input className="design-input" aria-label="New board slug" placeholder="Folder name" maxLength={48} value={newSlug} onChange={event => setNewSlug(event.target.value)} />
      <button type="submit" className="design-button primary" disabled={loading || saving || !newName.trim()}>Create board</button>
      <button type="button" className="design-icon-button" aria-label="Cancel creation" onClick={() => setCreateOpen(false)}><X size={15} /></button>
    </form> : null}
  </>;
}

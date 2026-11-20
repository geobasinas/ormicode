import { ChevronDown, PenTool, SquareCode } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu.tsx';

export type Workspace = 'code' | 'design';
const workspaces = [{ id: 'code', label: 'Code', icon: SquareCode }, { id: 'design', label: 'Design', icon: PenTool }] as const;
const noDrag = { WebkitAppRegion: 'no-drag' } as const;

export function WorkspaceSwitcher({ workspace, onChange }: { workspace: Workspace; onChange(workspace: Workspace): void }) {
  const current = workspaces.find(item => item.id === workspace)!;
  const Icon = current.icon;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button aria-label={`Workspace: ${current.label}`} style={{ ...noDrag, display: 'inline-flex', alignItems: 'center', gap: 7, height: 28, marginLeft: 12, padding: '0 9px', borderRadius: 8, border: '1px solid var(--line-divider)', background: 'var(--bg-card)', color: 'var(--text-label)', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>
        <Icon size={14} aria-hidden /><span>{current.label}</span><ChevronDown size={12} aria-hidden style={{ color: 'var(--text-secondary)', marginLeft: 4 }} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" style={{ ...noDrag, background: 'var(--bg-card)', color: 'var(--text-label)', borderColor: 'var(--line-divider)' }}>
      <DropdownMenuRadioGroup value={workspace} onValueChange={value => { if (value === 'code' || value === 'design') onChange(value); }}>
        {workspaces.map(({ id, label, icon: ItemIcon }) => <DropdownMenuRadioItem key={id} value={id}><ItemIcon aria-hidden size={14} />{label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

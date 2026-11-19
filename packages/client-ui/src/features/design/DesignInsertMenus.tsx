import { useRef } from 'react';
import { ChevronDown, Frame, Monitor, Plus, Smartphone, SquarePlus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { DESIGN_IMAGE_TYPES } from './design-image.ts';

export function InsertFrameMenu({ disabled, addFrame }: { disabled: boolean; addFrame(kind: 'phone' | 'desktop' | 'blank'): void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="design-button primary" disabled={disabled}><Plus size={15} /><span>Add frame</span><ChevronDown size={12} /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => addFrame('phone')}><Smartphone size={15} /> Phone frame</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => addFrame('desktop')}><Monitor size={15} /> Desktop frame</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => addFrame('blank')}><Frame size={15} /> Blank frame</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function InsertElementMenu({ disabled, addElement, addImage }: { disabled: boolean; addElement(kind: string): void; addImage(file: File): void }) {
  const image = useRef<HTMLInputElement>(null);
  return <>
    <input ref={image} hidden type="file" accept={DESIGN_IMAGE_TYPES} aria-label="Insert image file" disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) addImage(file);
    }} />
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="design-icon-button" title="Insert element" aria-label="Insert element" disabled={disabled}><SquarePlus size={16} /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => addElement('text')}>Text</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => addElement('heading')}>Heading</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => addElement('button')}>Button</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => addElement('container')}>Container</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => addElement('rectangle')}>Rectangle</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => image.current?.click()}>Image from file…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}

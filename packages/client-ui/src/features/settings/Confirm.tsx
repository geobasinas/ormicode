/** A button that asks once in a themed dialog before doing something it can't undo. */
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button.tsx';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '../../components/ui/alert-dialog.tsx';

export function Confirm({ label, title, description, confirm, onConfirm, disabled, danger = true }: {
  label: string; title: string; description: ReactNode; confirm: string; onConfirm(): void | Promise<void>; disabled?: boolean; danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger asChild><Button variant="ghost" disabled={disabled} style={danger ? { color: 'var(--accent-red)' } : undefined}>{label}</Button></AlertDialogTrigger>
    <AlertDialogContent size="sm">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
        <AlertDialogAction size="sm" variant={danger ? 'destructive' : 'default'} onClick={() => void onConfirm()}>{confirm}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

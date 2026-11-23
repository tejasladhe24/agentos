import { useState } from 'react';
import { Button } from '@agentos/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';

export type SecretDeleteDialogProps = {
  open: boolean;
  secretKey: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (key: string) => Promise<void>;
};

export function SecretDeleteDialog({
  open,
  secretKey,
  onOpenChange,
  onConfirm,
}: SecretDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!secretKey) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(secretKey);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent data-slot="secret-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete secret</DialogTitle>
          <DialogDescription>
            Permanently remove{' '}
            <span className="font-mono text-foreground">{secretKey}</span> from
            the org vault. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={busy || !secretKey}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, type FormEvent } from 'react';
import { Button } from '@agentos/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';

import { validateSecretKeyClient } from '../lib/secret-key';

export type SecretCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rotate';
  initialKey?: string;
  onSubmit: (input: {
    key: string;
    value: string;
    expiresAt?: string;
  }) => Promise<void>;
};

export function SecretCreateDialog({
  open,
  onOpenChange,
  mode,
  initialKey = '',
  onSubmit,
}: SecretCreateDialogProps) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isRotate = mode === 'rotate';

  function reset() {
    setKey(initialKey);
    setValue('');
    setExpiresAt('');
    setError(null);
    setSaving(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyError = isRotate ? null : validateSecretKeyClient(key);
    if (keyError) {
      setError(keyError);
      return;
    }
    if (!value) {
      setError('Value is required');
      return;
    }
    if (isRotate && !window.confirm(`Overwrite secret “${initialKey}”?`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        key: isRotate ? initialKey : key.trim(),
        value,
        expiresAt: expiresAt.trim() || undefined,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-slot="secret-create-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isRotate ? 'Rotate secret' : 'Create secret'}
            </DialogTitle>
            <DialogDescription>
              {isRotate
                ? 'Replace the vault value. The previous value is overwritten.'
                : 'Store an encrypted value for the active organization.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="mt-3">
            {!isRotate ? (
              <Field>
                <FieldLabel htmlFor="secret-key">Key</FieldLabel>
                <Input
                  id="secret-key"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saving}
                />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                Key:{' '}
                <span className="font-mono text-foreground">{initialKey}</span>
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="secret-value">Value</FieldLabel>
              <Input
                id="secret-value"
                type="password"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoComplete="off"
                disabled={saving}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="secret-expires">
                Expires at (optional ISO)
              </FieldLabel>
              <Input
                id="secret-expires"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                placeholder="2030-01-01T00:00:00.000Z"
                autoComplete="off"
                disabled={saving}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isRotate ? 'Rotate' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

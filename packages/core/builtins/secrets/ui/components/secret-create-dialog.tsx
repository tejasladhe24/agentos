import { useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
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

function createSecretSchema(isRotate: boolean) {
  return z
    .object({
      key: z.string(),
      value: z.string().min(1, 'Value is required'),
      expiresAt: z
        .string()
        .refine(
          (raw) => !raw.trim() || !Number.isNaN(Date.parse(raw.trim())),
          'Enter a valid ISO timestamp (e.g. 2030-01-01T00:00:00.000Z)',
        ),
    })
    .superRefine((data, ctx) => {
      if (isRotate) return;
      const keyError = validateSecretKeyClient(data.key);
      if (keyError) {
        ctx.addIssue({
          code: 'custom',
          message: keyError,
          path: ['key'],
        });
      }
    });
}

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isRotate = mode === 'rotate';
  const schema = useMemo(() => createSecretSchema(isRotate), [isRotate]);

  const form = useForm({
    defaultValues: {
      key: initialKey,
      value: '',
      expiresAt: '',
    },
    validators: {
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => {
      if (isRotate && !window.confirm(`Overwrite secret “${initialKey}”?`)) {
        return;
      }
      setSubmitError(null);
      try {
        await onSubmit({
          key: isRotate ? initialKey : value.key.trim(),
          value: value.value,
          expiresAt: value.expiresAt.trim() || undefined,
        });
        form.reset({ key: initialKey, value: '', expiresAt: '' });
        onOpenChange(false);
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to save secret',
        );
      }
    },
  });

  function reset() {
    form.reset({ key: initialKey, value: '', expiresAt: '' });
    setSubmitError(null);
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
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
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
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(saving) => (
              <>
                <FieldGroup className="mt-3">
                  {!isRotate ? (
                    <form.Field name="key">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="secret-key">Key</FieldLabel>
                            <Input
                              id="secret-key"
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                field.handleChange(event.target.value);
                                if (submitError) setSubmitError(null);
                              }}
                              autoComplete="off"
                              spellCheck={false}
                              disabled={saving}
                              aria-invalid={invalid || undefined}
                            />
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </form.Field>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Key:{' '}
                      <span className="font-mono text-foreground">
                        {initialKey}
                      </span>
                    </p>
                  )}
                  <form.Field name="value">
                    {(field) => {
                      const invalid = isFieldInvalid(field.state.meta);
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <FieldLabel htmlFor="secret-value">Value</FieldLabel>
                          <Input
                            id="secret-value"
                            name={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => {
                              field.handleChange(event.target.value);
                              if (submitError) setSubmitError(null);
                            }}
                            autoComplete="off"
                            disabled={saving}
                            aria-invalid={invalid || undefined}
                          />
                          {invalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : null}
                        </Field>
                      );
                    }}
                  </form.Field>
                  <form.Field name="expiresAt">
                    {(field) => {
                      const invalid = isFieldInvalid(field.state.meta);
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <FieldLabel htmlFor="secret-expires">
                            Expires at (optional ISO)
                          </FieldLabel>
                          <Input
                            id="secret-expires"
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => {
                              field.handleChange(event.target.value);
                              if (submitError) setSubmitError(null);
                            }}
                            placeholder="2030-01-01T00:00:00.000Z"
                            autoComplete="off"
                            disabled={saving}
                            aria-invalid={invalid || undefined}
                          />
                          {invalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : null}
                        </Field>
                      );
                    }}
                  </form.Field>
                  {submitError ? <FieldError>{submitError}</FieldError> : null}
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
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

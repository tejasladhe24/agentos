import { useCallback, useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
  useHostNotifications,
} from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { LoadingState } from '@agentos/ui/components/loading-state';

export const USER_EMAIL_PREFS_PATH = '/api/ext/notifications/preferences/email';

export type UserEmailFromData = {
  from: string | null;
  orgFrom: string | null;
};

const SIMPLE_EMAIL_SCHEMA = z.string().email();

function isValidFromAddress(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const angleMatch = /^[^<>]+<([^<>]+)>$/.exec(trimmed);
  const emailPart = angleMatch ? angleMatch[1].trim() : trimmed;
  return SIMPLE_EMAIL_SCHEMA.safeParse(emailPart).success;
}

const userEmailFromSchema = z.object({
  from: z
    .string()
    .refine(
      isValidFromAddress,
      'Enter a valid email or "Name <email@domain.com>"',
    ),
});

function parseError(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
  } catch {
    // non-JSON body
  }
  return fallback;
}

export type UserEmailFromCardViewProps = {
  savedFrom: string | null;
  orgFrom: string | null;
  busy?: boolean;
  error?: string | null;
  entryId?: string;
  onSave: (nextFrom: string | null) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  onClearError?: () => void;
};

/** Presentational personal sender address section (SSR / test friendly). */
export function UserEmailFromCardView({
  savedFrom,
  orgFrom,
  busy = false,
  error = null,
  entryId,
  onSave,
  onClear,
  onClearError,
}: UserEmailFromCardViewProps) {
  const form = useForm({
    defaultValues: { from: savedFrom ?? '' },
    validators: { onSubmit: userEmailFromSchema },
    onSubmit: async ({ value }) => {
      await onSave(value.from.trim() || null);
    },
  });

  useEffect(() => {
    form.reset({ from: savedFrom ?? '' });
  }, [savedFrom, form]);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => {
          const disabled = busy || isSubmitting;
          return (
            <FieldSet
              data-slot="user-email-from-card"
              data-setting-entry={entryId}
            >
              <FieldLegend>Your sender address</FieldLegend>
              <FieldDescription>
                Choose the From address used when you send email through your
                organization&apos;s email provider.
              </FieldDescription>
              <FieldGroup>
                <form.Field name="from">
                  {(field) => {
                    const fieldInvalid = isFieldInvalid(field.state.meta);
                    const invalid = fieldInvalid || Boolean(error);
                    return (
                      <Field
                        orientation="responsive"
                        data-invalid={invalid || undefined}
                      >
                        <FieldContent>
                          <FieldLabel htmlFor="user-email-from">
                            From address
                          </FieldLabel>
                          <FieldDescription>
                            Must use a domain verified on your
                            organization&apos;s email provider.
                            {orgFrom
                              ? ` Leave blank to use the organization default (${orgFrom}).`
                              : ' Leave blank to use the organization default.'}
                          </FieldDescription>
                          {fieldInvalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : error ? (
                            <FieldError>{error}</FieldError>
                          ) : null}
                        </FieldContent>
                        <Input
                          id="user-email-from"
                          name={field.name}
                          value={field.state.value}
                          placeholder={orgFrom || 'Jane Doe <jane@acme.com>'}
                          disabled={disabled}
                          aria-invalid={invalid || undefined}
                          className="sm:max-w-60"
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                            if (error) onClearError?.();
                          }}
                        />
                      </Field>
                    );
                  }}
                </form.Field>
                <Field
                  orientation="horizontal"
                  className="flex-wrap justify-end gap-2"
                >
                  {savedFrom ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => void onClear()}
                    >
                      Use organization default
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" disabled={disabled}>
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </Button>
                </Field>
              </FieldGroup>
            </FieldSet>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

/** Self-loading per-user email sender address section for Settings → Email. */
export function UserEmailFromCard({ entryId }: { entryId?: string }) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<UserEmailFromData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.fetch(USER_EMAIL_PREFS_PATH);
    setLoading(false);
    if (!res.ok) {
      const message = parseError(res.body, 'Could not load sender address.');
      setError(message);
      void notifications.show(message, 'error');
      return;
    }
    try {
      const parsed = JSON.parse(res.body) as UserEmailFromData;
      setData(parsed);
      setError(null);
    } catch {
      setError('Invalid sender preference response.');
    }
  }, [api, notifications]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextFrom: string | null) {
    setBusy(true);
    setError(null);
    const res = await api.fetch(USER_EMAIL_PREFS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: nextFrom }),
    });
    setBusy(false);
    if (!res.ok) {
      const message = parseError(res.body, 'Could not save sender address.');
      setError(message);
      await notifications.show(message, 'error');
      return;
    }
    try {
      const parsed = JSON.parse(res.body) as UserEmailFromData;
      setData(parsed);
    } catch {
      await load();
    }
    await notifications.show(
      nextFrom ? 'Sender address saved' : 'Reset to organization default',
      'info',
    );
  }

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;

  return (
    <UserEmailFromCardView
      savedFrom={data?.from ?? null}
      orgFrom={data?.orgFrom ?? null}
      busy={busy}
      error={error}
      entryId={entryId}
      onSave={save}
      onClear={() => save(null)}
      onClearError={() => setError(null)}
    />
  );
}

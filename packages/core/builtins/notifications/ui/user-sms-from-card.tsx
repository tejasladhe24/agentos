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
import { LoadingState } from '@agentos/ui/components/loading-state';

import { SmsNumberSelect, smsNumbersHint } from './sms-number-select';
import type { SmsNumbersState } from './use-sms-numbers';

export const USER_SMS_PREFS_PATH = '/preferences/sms';

export type UserSmsFromData = {
  from: string | null;
  orgFrom: string | null;
};

const userSmsFromSchema = z.object({
  from: z
    .string()
    .refine(
      (value) => !value || /^\+[1-9]\d{6,14}$/.test(value),
      'Pick a phone number from the list',
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

export type UserSmsFromCardViewProps = {
  savedFrom: string | null;
  orgFrom: string | null;
  numbers: Pick<
    SmsNumbersState,
    'loading' | 'configured' | 'numbers' | 'error'
  >;
  busy?: boolean;
  error?: string | null;
  entryId?: string;
  onSave: (nextFrom: string | null) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  onClearError?: () => void;
};

/** Presentational personal sender number section (SSR / test friendly). */
export function UserSmsFromCardView({
  savedFrom,
  orgFrom,
  numbers,
  busy = false,
  error = null,
  entryId,
  onSave,
  onClear,
  onClearError,
}: UserSmsFromCardViewProps) {
  const form = useForm({
    defaultValues: { from: savedFrom ?? '' },
    validators: { onSubmit: userSmsFromSchema },
    onSubmit: async ({ value }) => {
      await onSave(value.from.trim() || null);
    },
  });

  useEffect(() => {
    form.reset({ from: savedFrom ?? '' });
  }, [savedFrom, form]);

  const hint = smsNumbersHint(numbers, 'member');

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
              data-slot="user-sms-from-card"
              data-setting-entry={entryId}
            >
              <FieldLegend>Your sender number</FieldLegend>
              <FieldDescription>
                Choose the number your text messages are sent from when you send
                SMS through your organization&apos;s Twilio account.
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
                          <FieldLabel htmlFor="user-sms-from">
                            From number
                          </FieldLabel>
                          <FieldDescription>
                            Numbers come from your organization&apos;s Twilio
                            account.
                            {orgFrom
                              ? ` Leave unset to use the organization default (${orgFrom}).`
                              : ' Leave unset to use the organization default.'}
                          </FieldDescription>
                          {fieldInvalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : error ? (
                            <FieldError>{error}</FieldError>
                          ) : null}
                          {numbers.error ? (
                            <FieldError>{numbers.error}</FieldError>
                          ) : null}
                          {hint ? (
                            <FieldDescription>{hint}</FieldDescription>
                          ) : null}
                        </FieldContent>
                        <SmsNumberSelect
                          id="user-sms-from"
                          value={field.state.value}
                          numbers={numbers.numbers}
                          noneLabel="Organization default"
                          placeholder={orgFrom ?? 'Organization default'}
                          disabled={disabled || numbers.loading}
                          invalid={invalid}
                          onValueChange={(next) => {
                            field.handleChange(next);
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

/** Self-loading per-user SMS sender number section for Settings → SMS. */
export function UserSmsFromCard({
  entryId,
  numbers,
}: {
  entryId?: string;
  numbers: SmsNumbersState;
}) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<UserSmsFromData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.fetch(USER_SMS_PREFS_PATH);
    setLoading(false);
    if (!res.ok) {
      const message = parseError(res.body, 'Could not load sender number.');
      setError(message);
      void notifications.show(message, 'error');
      return;
    }
    try {
      setData(JSON.parse(res.body) as UserSmsFromData);
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
    const res = await api.fetch(USER_SMS_PREFS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: nextFrom }),
    });
    setBusy(false);
    if (!res.ok) {
      const message = parseError(res.body, 'Could not save sender number.');
      setError(message);
      await notifications.show(message, 'error');
      return;
    }
    try {
      setData(JSON.parse(res.body) as UserSmsFromData);
    } catch {
      await load();
    }
    await notifications.show(
      nextFrom ? 'Sender number saved' : 'Reset to organization default',
      'info',
    );
  }

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;

  return (
    <UserSmsFromCardView
      savedFrom={data?.from ?? null}
      orgFrom={data?.orgFrom ?? null}
      numbers={numbers}
      busy={busy}
      error={error}
      entryId={entryId}
      onSave={save}
      onClear={() => save(null)}
      onClearError={() => setError(null)}
    />
  );
}

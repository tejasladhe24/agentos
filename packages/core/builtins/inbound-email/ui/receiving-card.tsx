import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
  useHostNotifications,
} from '@agentos/core/client';
import {
  IntegrationCard,
  IntegrationRemoveButton,
  IntegrationSecretField,
  IntegrationStatusInfo,
  IntegrationTestButton,
  IntegrationTextField,
  type IntegrationTestOutcome,
} from '@agentos/core/client/components/integration-card';
import type { IntegrationSectionData } from '@agentos/core/client/components/integration-section';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { Checkbox } from '@agentos/ui/components/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { LoadingState } from '@agentos/ui/components/loading-state';

import {
  EMPTY_RECEIVING_DRAFT,
  RECEIVE_INTEGRATION_PATH,
  receivingDraftBody,
  receivingWebhookUrl,
  SEND_INTEGRATION_PATH,
  parseWebhookStatus,
  WEBHOOK_STATUS_LABELS,
  type ReceivingDraft,
} from './receiving';

const SECRET_FIELDS = {
  apiKey: { name: 'apiKey', label: 'Resend API key', placeholder: 're_…' },
  signingSecret: {
    name: 'signingSecret',
    label: 'Webhook signing secret',
    placeholder: 'whsec_…',
    description:
      'Only needed for manual setup: copy it from the webhook in Resend.',
  },
};

function createReceivingSchema(hasSavedApiKey: boolean) {
  return z
    .object({
      receivingDomain: z.string().trim().min(1, 'Receiving domain is required'),
      apiKey: z.string(),
      signingSecret: z.string(),
      useSendingKey: z.boolean(),
    })
    .superRefine((draft, ctx) => {
      if (!draft.useSendingKey && !hasSavedApiKey && !draft.apiKey.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Resend API key is required',
          path: ['apiKey'],
        });
      }
    });
}

function errorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // non-JSON body
  }
  return fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Email settings → Receiving: the org's own Resend account for inbound mail.
 * Saving a key registers the `email.received` webhook; when the key cannot
 * manage webhooks the card shows the URL + signing-secret field instead.
 */
export function ReceivingCard({ entryId }: { entryId?: string }) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<IntegrationSectionData | null>(null);
  const [sendingUsesResend, setSendingUsesResend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = data?.instances[0];
  const hasSavedApiKey = saved?.secrets.apiKey?.set === true;
  const schema = useMemo(
    () => createReceivingSchema(hasSavedApiKey),
    [hasSavedApiKey],
  );

  const form = useForm({
    defaultValues: EMPTY_RECEIVING_DRAFT as ReceivingDraft,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setError(null);
      const res = await api.fetch(RECEIVE_INTEGRATION_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(receivingDraftBody(value)),
      });
      if (!res.ok) {
        const message = errorMessage(
          res.body,
          'Could not save email receiving.',
        );
        setError(message);
        await notifications.show(message, 'error');
        return;
      }
      await notifications.show('Email receiving saved', 'info');
      await load();
    },
  });

  const load = useCallback(async () => {
    const [receive, send] = await Promise.all([
      api.fetch(RECEIVE_INTEGRATION_PATH),
      api.fetch(SEND_INTEGRATION_PATH),
    ]);
    setLoading(false);
    if (!receive.ok) {
      const message = errorMessage(
        receive.body,
        'Could not load email receiving.',
      );
      setError(message);
      void notifications.show(message, 'error');
      return;
    }
    try {
      const next = JSON.parse(receive.body) as IntegrationSectionData;
      setData(next);
      form.reset({
        ...EMPTY_RECEIVING_DRAFT,
        receivingDomain: str(next.instances[0]?.settings.receivingDomain),
      });
      setError(null);
    } catch {
      setError('Invalid integration response.');
    }
    if (send.ok) {
      try {
        const sending = JSON.parse(send.body) as IntegrationSectionData;
        const savedSending = sending.instances[0];
        setSendingUsesResend(
          savedSending?.provider === 'resend' &&
            savedSending.secrets.apiKey?.set === true,
        );
      } catch {
        setSendingUsesResend(false);
      }
    }
  }, [api, form, notifications]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;
  if (!data) return <FieldError>{error}</FieldError>;

  const readOnly = !data.canManage;
  const status = parseWebhookStatus(saved?.settings.webhookStatus);
  const connectionId = str(saved?.settings.connectionId);
  const webhookError = str(saved?.settings.webhookError);
  const webhookUrl = connectionId
    ? receivingWebhookUrl(connectionId, window.location.origin)
    : '';
  const showManual = status === 'manual' || status === 'failing';

  const remove = async () => {
    setBusy(true);
    const res = await api.fetch(RECEIVE_INTEGRATION_PATH, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      const message = errorMessage(
        res.body,
        'Could not remove email receiving.',
      );
      setError(message);
      await notifications.show(message, 'error');
      return;
    }
    await notifications.show('Email receiving removed', 'info');
    await load();
  };

  const test = async (): Promise<IntegrationTestOutcome> => {
    const res = await api.fetch(`${RECEIVE_INTEGRATION_PATH}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      return { ok: false, message: errorMessage(res.body, 'Test failed') };
    }
    return JSON.parse(res.body) as IntegrationTestOutcome;
  };

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
          const disabled = readOnly || busy || isSubmitting;
          return (
            <IntegrationCard
              title="Email receiving"
              description="Receive email for your domain through your own Resend account."
              source={saved ? 'tenant' : 'platform'}
              platformConfigured={data.platformDefault?.configured ?? true}
              entryId={entryId}
              footer={
                readOnly ? (
                  <FieldDescription>
                    Only admins can change this integration.
                  </FieldDescription>
                ) : (
                  <>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={busy || isSubmitting}
                    >
                      {isSubmitting ? 'Saving…' : 'Save'}
                    </Button>
                    {saved ? (
                      <IntegrationTestButton
                        onTest={test}
                        disabled={busy || isSubmitting}
                      />
                    ) : null}
                    {saved ? (
                      <span className="ml-auto">
                        <IntegrationRemoveButton
                          name="Email receiving"
                          onConfirm={remove}
                          disabled={busy || isSubmitting}
                        />
                      </span>
                    ) : null}
                  </>
                )
              }
            >
              {!saved ? (
                <FieldDescription>
                  {data.platformDefault?.configured
                    ? 'Mail sent to your provisioned addresses arrives through the platform default until you connect your own Resend account.'
                    : 'No platform default is configured. Connect your Resend account to receive email.'}
                </FieldDescription>
              ) : null}
              {status ? (
                <Field orientation="horizontal" data-slot="webhook-status">
                  <FieldContent>
                    <FieldTitle className="relative">
                      {status !== 'registered' ? (
                        <IntegrationStatusInfo
                          message={
                            webhookError
                              ? `${WEBHOOK_STATUS_LABELS[status]} — ${webhookError}`
                              : WEBHOOK_STATUS_LABELS[status]
                          }
                          tone={status === 'failing' ? 'error' : 'warning'}
                          slot="webhook-status-info"
                        />
                      ) : null}
                      <span>Webhook status</span>
                    </FieldTitle>
                    {webhookError ? (
                      <FieldDescription>{webhookError}</FieldDescription>
                    ) : null}
                  </FieldContent>
                  {status === 'registered' ? (
                    <Badge variant="outline">
                      {WEBHOOK_STATUS_LABELS[status]}
                    </Badge>
                  ) : null}
                </Field>
              ) : null}
              <form.Field name="receivingDomain">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <IntegrationTextField
                      id="email-receive-domain"
                      field={{
                        name: 'receivingDomain',
                        label: 'Receiving domain',
                        required: true,
                        placeholder: 'inbound.example.com',
                        description:
                          'In Resend → Domains, enable receiving for this domain and add the MX record Resend shows to your DNS.',
                      }}
                      value={field.state.value}
                      disabled={disabled}
                      errors={
                        invalid
                          ? toFieldErrors(field.state.meta.errors)
                          : undefined
                      }
                      onBlur={field.handleBlur}
                      onValueChange={(receivingDomain) => {
                        field.handleChange(receivingDomain);
                        if (error) setError(null);
                      }}
                    />
                  );
                }}
              </form.Field>
              {sendingUsesResend ? (
                <form.Field name="useSendingKey">
                  {(field) => (
                    <Field orientation="horizontal" data-slot="use-sending-key">
                      <FieldContent>
                        <FieldLabel htmlFor="email-receive-same-key">
                          Use the same Resend key as Email sending
                        </FieldLabel>
                      </FieldContent>
                      <Checkbox
                        id="email-receive-same-key"
                        checked={field.state.value}
                        disabled={disabled}
                        onCheckedChange={(checked) => {
                          field.handleChange(checked === true);
                          if (error) setError(null);
                        }}
                      />
                    </Field>
                  )}
                </form.Field>
              ) : null}
              <form.Subscribe selector={(state) => state.values.useSendingKey}>
                {(useSendingKey) =>
                  useSendingKey ? null : (
                    <form.Field name="apiKey">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <IntegrationSecretField
                            id="email-receive-api-key"
                            field={SECRET_FIELDS.apiKey}
                            status={saved?.secrets.apiKey}
                            value={field.state.value}
                            disabled={disabled}
                            errors={
                              invalid
                                ? toFieldErrors(field.state.meta.errors)
                                : undefined
                            }
                            onBlur={field.handleBlur}
                            onValueChange={(apiKey) => {
                              field.handleChange(apiKey);
                              if (error) setError(null);
                            }}
                          />
                        );
                      }}
                    </form.Field>
                  )
                }
              </form.Subscribe>
              {webhookUrl ? (
                <Field orientation="responsive" data-slot="webhook-url">
                  <FieldContent>
                    <FieldLabel htmlFor="email-receive-webhook-url">
                      Webhook URL
                    </FieldLabel>
                    <FieldDescription>
                      {showManual
                        ? 'In Resend → Webhooks, add this URL for the email.received event, then paste the signing secret below.'
                        : 'Registered in your Resend account for the email.received event.'}
                    </FieldDescription>
                  </FieldContent>
                  <div className="flex w-full items-center gap-2 sm:max-w-60">
                    <Input
                      id="email-receive-webhook-url"
                      readOnly
                      value={webhookUrl}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(webhookUrl);
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </Field>
              ) : null}
              {showManual ? (
                <form.Field name="signingSecret">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <IntegrationSecretField
                        id="email-receive-signing-secret"
                        field={SECRET_FIELDS.signingSecret}
                        status={saved?.secrets.signingSecret}
                        value={field.state.value}
                        disabled={disabled}
                        errors={
                          invalid
                            ? toFieldErrors(field.state.meta.errors)
                            : undefined
                        }
                        onBlur={field.handleBlur}
                        onValueChange={(signingSecret) => {
                          field.handleChange(signingSecret);
                          if (error) setError(null);
                        }}
                      />
                    );
                  }}
                </form.Field>
              ) : null}
              {error ? <FieldError>{error}</FieldError> : null}
            </IntegrationCard>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

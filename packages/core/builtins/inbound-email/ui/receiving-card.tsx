import { useCallback, useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import {
  IntegrationCard,
  IntegrationRemoveButton,
  IntegrationSecretField,
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
  FieldDescription,
  FieldError,
  FieldLabel,
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
  const [draft, setDraft] = useState<ReceivingDraft>(EMPTY_RECEIVING_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [receive, send] = await Promise.all([
      api.fetch(RECEIVE_INTEGRATION_PATH),
      api.fetch(SEND_INTEGRATION_PATH),
    ]);
    setLoading(false);
    if (!receive.ok) {
      setError(errorMessage(receive.body, 'Could not load email receiving.'));
      return;
    }
    try {
      const next = JSON.parse(receive.body) as IntegrationSectionData;
      setData(next);
      setDraft({
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
        const saved = sending.instances[0];
        setSendingUsesResend(
          saved?.provider === 'resend' && saved.secrets.apiKey?.set === true,
        );
      } catch {
        setSendingUsesResend(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;
  if (!data) return <FieldError>{error}</FieldError>;

  const saved = data.instances[0];
  const readOnly = !data.canManage;
  const disabled = readOnly || busy;
  const status = parseWebhookStatus(saved?.settings.webhookStatus);
  const connectionId = str(saved?.settings.connectionId);
  const webhookError = str(saved?.settings.webhookError);
  const webhookUrl = connectionId
    ? receivingWebhookUrl(connectionId, window.location.origin)
    : '';
  const showManual = status === 'manual' || status === 'failing';

  const save = async () => {
    setBusy(true);
    const res = await api.fetch(RECEIVE_INTEGRATION_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receivingDraftBody(draft)),
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res.body, 'Could not save email receiving.'));
      return;
    }
    await notifications.show('Email receiving saved', 'info');
    await load();
  };

  const remove = async () => {
    setBusy(true);
    const res = await api.fetch(RECEIVE_INTEGRATION_PATH, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res.body, 'Could not remove email receiving.'));
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
    <IntegrationCard
      title="Email receiving"
      description="Receive email for your domain through your own Resend account."
      source={saved ? 'tenant' : 'platform'}
      platformConfigured={data.platformDefault?.configured ?? true}
      entryId={entryId}
      footer={
        readOnly ? (
          <span className="text-xs text-muted-foreground">
            Only admins can change this integration.
          </span>
        ) : (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={save}>
              Save
            </Button>
            {saved ? (
              <IntegrationTestButton onTest={test} disabled={busy} />
            ) : null}
            {saved ? (
              <span className="ml-auto">
                <IntegrationRemoveButton
                  name="Email receiving"
                  onConfirm={remove}
                  disabled={busy}
                />
              </span>
            ) : null}
          </>
        )
      }
    >
      {!saved ? (
        <p className="text-xs text-muted-foreground">
          {data.platformDefault?.configured
            ? 'Mail sent to your provisioned addresses arrives through the platform default until you connect your own Resend account.'
            : 'No platform default is configured. Connect your Resend account to receive email.'}
        </p>
      ) : null}
      {status ? (
        <div className="flex items-center gap-2" data-slot="webhook-status">
          <Badge variant={status === 'failing' ? 'destructive' : 'outline'}>
            {WEBHOOK_STATUS_LABELS[status]}
          </Badge>
          {webhookError ? (
            <span className="text-xs text-muted-foreground">
              {webhookError}
            </span>
          ) : null}
        </div>
      ) : null}
      <IntegrationTextField
        id="email-receive-domain"
        field={{
          name: 'receivingDomain',
          label: 'Receiving domain',
          placeholder: 'inbound.example.com',
          description:
            'In Resend → Domains, enable receiving for this domain and add the MX record Resend shows to your DNS.',
        }}
        value={draft.receivingDomain}
        disabled={disabled}
        onValueChange={(receivingDomain) =>
          setDraft({ ...draft, receivingDomain })
        }
      />
      {sendingUsesResend ? (
        <Field orientation="horizontal" data-slot="use-sending-key">
          <Checkbox
            id="email-receive-same-key"
            checked={draft.useSendingKey}
            disabled={disabled}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, useSendingKey: checked === true })
            }
          />
          <FieldLabel htmlFor="email-receive-same-key">
            Use the same Resend key as Email sending
          </FieldLabel>
        </Field>
      ) : null}
      {draft.useSendingKey ? null : (
        <IntegrationSecretField
          id="email-receive-api-key"
          field={SECRET_FIELDS.apiKey}
          status={saved?.secrets.apiKey}
          value={draft.apiKey}
          disabled={disabled}
          onValueChange={(apiKey) => setDraft({ ...draft, apiKey })}
        />
      )}
      {webhookUrl ? (
        <Field data-slot="webhook-url">
          <FieldLabel htmlFor="email-receive-webhook-url">
            Webhook URL
          </FieldLabel>
          <div className="flex gap-2">
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
          <FieldDescription>
            {showManual
              ? 'In Resend → Webhooks, add this URL for the email.received event, then paste the signing secret below.'
              : 'Registered in your Resend account for the email.received event.'}
          </FieldDescription>
        </Field>
      ) : null}
      {showManual ? (
        <IntegrationSecretField
          id="email-receive-signing-secret"
          field={SECRET_FIELDS.signingSecret}
          status={saved?.secrets.signingSecret}
          value={draft.signingSecret}
          disabled={disabled}
          onValueChange={(signingSecret) =>
            setDraft({ ...draft, signingSecret })
          }
        />
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </IntegrationCard>
  );
}

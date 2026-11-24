import {
  IntegrationError,
  type IntegrationDefinition,
  type IntegrationDraft,
  type IntegrationsKit,
  type ResolvedIntegration,
} from '@agentos/core/api/integrations';

import {
  isValidConnectionId,
  newConnectionId,
  type ConnectionStore,
} from './connection-store';
import { createResendClient, ResendApiError } from './providers/resend';

export const EMAIL_RECEIVE_INTEGRATION = 'email.receive';
export const EMAIL_SEND_INTEGRATION = 'email.send';

/** Gateway path of the BYOK Resend webhook (suffix `/<connectionId>`). */
export const RESEND_CONNECTION_WEBHOOK_PATH =
  '/api/ext/inbound-email/webhooks/resend';

export type WebhookStatus = 'registered' | 'manual' | 'failing';

/** Settings the server owns; values sent by the client are ignored. */
const MANAGED_SETTINGS = [
  'connectionId',
  'webhookId',
  'webhookStatus',
  'webhookError',
] as const;

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type InboundIntegrationOptions = {
  kit: Pick<IntegrationsKit, 'getIntegration'>;
  connections: ConnectionStore;
  /** Public HTTPS origin (`AGENT_OS_GLOBAL_APP_ORIGIN`) for webhook URLs. */
  publicOrigin?: string;
  platform: { provider: string; configured: boolean };
  fetchImpl?: FetchImpl;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function resendWebhookUrl(
  connectionId: string,
  publicOrigin?: string,
): string {
  const path = `${RESEND_CONNECTION_WEBHOOK_PATH}/${connectionId}`;
  const origin = publicOrigin?.replace(/\/+$/, '');
  return origin ? `${origin}${path}` : path;
}

function describeKeyError(error: unknown): {
  status: WebhookStatus;
  message: string;
} {
  if (
    error instanceof ResendApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return {
      status: 'manual',
      message:
        'This key cannot manage webhooks. Add the webhook in Resend and paste its signing secret.',
    };
  }
  return {
    status: 'failing',
    message:
      error instanceof Error ? error.message : 'webhook registration failed',
  };
}

async function registerWebhook(input: {
  apiKey: string;
  endpoint: string;
  prior: ResolvedIntegration | null;
  keyChanged: boolean;
  fetchImpl?: FetchImpl;
}): Promise<{ webhookId?: string; signingSecret?: string }> {
  const client = createResendClient({
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const priorId = str(input.prior?.settings.webhookId);
  if (priorId) {
    try {
      // Same Resend account (rotation or retry): keep the webhook and secret.
      await client.updateWebhook(priorId, input.endpoint);
      return { webhookId: priorId };
    } catch (error) {
      if (!(error instanceof ResendApiError) || error.status !== 404) {
        throw error;
      }
    }
  }
  const created = await client.createWebhook(input.endpoint);
  const oldKey = str(input.prior?.secrets.apiKey);
  if (priorId && oldKey && input.keyChanged) {
    await createResendClient({ apiKey: oldKey, fetchImpl: input.fetchImpl })
      .deleteWebhook(priorId)
      .catch(() => undefined);
  }
  return { webhookId: created.id, signingSecret: created.signingSecret };
}

/** `email.receive` integration (Resend BYOK) served by inbound-email. */
export function inboundIntegrationDefinitions(
  options: InboundIntegrationOptions,
): IntegrationDefinition[] {
  const beforeSave: IntegrationDefinition['beforeSave'] = async ({
    orgId,
    instanceId,
    existing,
    draft,
    body,
  }) => {
    const prior = existing?.provider === draft.provider ? existing : null;
    const settings: Record<string, unknown> = { ...draft.settings };
    const secrets: IntegrationDraft['secrets'] = { ...draft.secrets };
    for (const key of MANAGED_SETTINGS) delete settings[key];

    const priorConnection = str(prior?.settings.connectionId);
    const connectionId = isValidConnectionId(priorConnection)
      ? priorConnection
      : newConnectionId();
    settings.connectionId = connectionId;
    await options.connections.put({
      connectionId,
      orgId,
      integration: EMAIL_RECEIVE_INTEGRATION,
      instanceId,
      createdAt: new Date().toISOString(),
    });

    if (body.useSendingKey === true) {
      const sending = await options.kit.getIntegration(
        orgId,
        EMAIL_SEND_INTEGRATION,
      );
      const sendingKey =
        sending?.provider === 'resend' ? str(sending.secrets.apiKey) : '';
      if (!sendingKey) {
        throw new IntegrationError(
          'Email sending is not using a Resend key',
          400,
        );
      }
      secrets.apiKey = sendingKey;
    }

    const suppliedKey = secrets.apiKey;
    const apiKey =
      typeof suppliedKey === 'string'
        ? suppliedKey
        : suppliedKey === null
          ? ''
          : str(prior?.secrets.apiKey);
    if (!apiKey) throw new IntegrationError('API key is required', 400);
    const keyChanged =
      typeof suppliedKey === 'string' &&
      suppliedKey !== str(prior?.secrets.apiKey);

    const carry = () => {
      for (const key of ['webhookId', 'webhookStatus', 'webhookError']) {
        if (prior?.settings[key] !== undefined) {
          settings[key] = prior.settings[key];
        }
      }
    };

    if (typeof secrets.signingSecret === 'string') {
      carry();
      settings.webhookStatus = 'manual';
      delete settings.webhookError;
      return { provider: draft.provider, settings, secrets };
    }

    if (
      !keyChanged &&
      prior?.settings.webhookStatus === 'registered' &&
      str(prior.settings.webhookId)
    ) {
      carry();
      return { provider: draft.provider, settings, secrets };
    }

    if (!options.publicOrigin) {
      carry();
      settings.webhookStatus = 'manual';
      settings.webhookError =
        'Public app origin is not configured; add the webhook in Resend manually.';
      return { provider: draft.provider, settings, secrets };
    }

    try {
      const result = await registerWebhook({
        apiKey,
        endpoint: resendWebhookUrl(connectionId, options.publicOrigin),
        prior,
        keyChanged,
        fetchImpl: options.fetchImpl,
      });
      settings.webhookId = result.webhookId;
      settings.webhookStatus = 'registered';
      if (result.signingSecret) secrets.signingSecret = result.signingSecret;
    } catch (error) {
      const failure = describeKeyError(error);
      if (prior?.settings.webhookId !== undefined && !keyChanged) {
        settings.webhookId = prior.settings.webhookId;
      }
      settings.webhookStatus = failure.status;
      settings.webhookError = failure.message;
    }
    return { provider: draft.provider, settings, secrets };
  };

  const afterDelete: IntegrationDefinition['afterDelete'] = async ({
    existing,
  }) => {
    const webhookId = str(existing.settings.webhookId);
    const apiKey = str(existing.secrets.apiKey);
    if (webhookId && apiKey && existing.provider === 'resend') {
      await createResendClient({ apiKey, fetchImpl: options.fetchImpl })
        .deleteWebhook(webhookId)
        .catch(() => undefined);
    }
    const connectionId = str(existing.settings.connectionId);
    if (connectionId) await options.connections.remove(connectionId);
  };

  return [
    {
      id: EMAIL_RECEIVE_INTEGRATION,
      label: 'Email receiving',
      description:
        'Receive email for your domain through your own Resend account.',
      providers: [
        {
          id: 'resend',
          label: 'Resend',
          settings: [
            {
              name: 'receivingDomain',
              label: 'Receiving domain',
              placeholder: 'inbound.example.com',
            },
            { name: 'connectionId', label: 'Connection id' },
            { name: 'webhookId', label: 'Webhook id' },
            { name: 'webhookStatus', label: 'Webhook status' },
            { name: 'webhookError', label: 'Webhook error' },
          ],
          secrets: [
            { name: 'apiKey', label: 'API key', placeholder: 're_…' },
            {
              name: 'signingSecret',
              label: 'Webhook signing secret',
              placeholder: 'whsec_…',
              description: 'Only needed when the webhook is added manually.',
            },
          ],
        },
      ],
      platformDefault: () => options.platform,
      beforeSave,
      afterDelete,
      async test({ config }) {
        if (!config) {
          return options.platform.configured
            ? {
                ok: true,
                message: `Platform default (${options.platform.provider}) is configured.`,
              }
            : {
                ok: false,
                message: 'No platform inbound provider is configured.',
              };
        }
        const domain = str(config.settings.receivingDomain);
        const hint = domain
          ? ` Send a message to any address at ${domain} and it will appear in Inbox.`
          : '';
        const webhookId = str(config.settings.webhookId);
        const apiKey = str(config.secrets.apiKey);
        if (!apiKey) return { ok: false, message: 'API key is not set.' };
        if (config.settings.webhookStatus === 'registered' && webhookId) {
          try {
            const webhook = await createResendClient({
              apiKey,
              fetchImpl: options.fetchImpl,
            }).getWebhook(webhookId);
            if (webhook.status && webhook.status !== 'enabled') {
              return {
                ok: false,
                message: `Resend webhook is ${webhook.status}.`,
              };
            }
            return { ok: true, message: `Webhook registered.${hint}` };
          } catch (error) {
            return {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }
        if (!str(config.secrets.signingSecret)) {
          return {
            ok: false,
            message:
              'Add the webhook in Resend, then paste its signing secret here.',
          };
        }
        return { ok: true, message: `Manual webhook configured.${hint}` };
      },
    },
  ];
}

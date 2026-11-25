import {
  IntegrationError,
  type IntegrationDefinition,
  type IntegrationsKit,
  type ResolvedIntegration,
} from '@agentos/core/api/integrations';

import {
  createCloudflareEmailProvider,
  resolveCloudflareAccountId,
} from './providers/cloudflare';
import type { NotificationProviders } from './providers/create-providers';
import { createResendProvider } from './providers/resend';
import { createTwilioProvider } from './providers/twilio';
import type { ChannelProvider } from './providers/types';

export const EMAIL_SEND_INTEGRATION = 'email.send';
export const SMS_INTEGRATION = 'sms';

export type DeliverySource = 'org' | 'platform';

const ORG_CONFIG_HINT = 'Check the provider settings in Settings.';

/** E.164: `+` and 7–15 digits, no leading zero. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

function draftSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function setting(config: ResolvedIntegration, name: string): string {
  const value = config.settings[name];
  return typeof value === 'string' ? value : '';
}

/** Build the org's email provider from its `email.send` integration. */
export function buildEmailProviderFromConfig(
  config: ResolvedIntegration,
  fetchImpl?: typeof fetch,
): ChannelProvider {
  if (config.provider === 'cloudflare') {
    return createCloudflareEmailProvider({
      accountId: setting(config, 'accountId'),
      apiToken: config.secrets.apiToken ?? '',
      from: setting(config, 'from'),
      fetchImpl,
      missingConfigError: `Cloudflare email needs an account id, API token, and from address. ${ORG_CONFIG_HINT}`,
    });
  }
  return createResendProvider({
    apiKey: config.secrets.apiKey ?? '',
    from: setting(config, 'from'),
    fetchImpl,
    missingConfigError: `Resend needs an API key and from address. ${ORG_CONFIG_HINT}`,
  });
}

/** Build the org's SMS provider from its `sms` integration. */
export function buildSmsProviderFromConfig(
  config: ResolvedIntegration,
  fetchImpl?: typeof fetch,
): ChannelProvider {
  return createTwilioProvider({
    accountSid: setting(config, 'accountSid'),
    apiKeySid: setting(config, 'apiKeySid'),
    apiKeySecret: config.secrets.apiKeySecret ?? '',
    from: setting(config, 'from'),
    fetchImpl,
    missingConfigError: `Twilio needs an account SID, API key SID, and API key secret. ${ORG_CONFIG_HINT}`,
  });
}

function platformName(provider: ChannelProvider): string {
  return provider.name.startsWith('log:') ? 'log' : provider.name;
}

/**
 * Per-request provider for a channel: org integration when configured, else
 * the platform env provider built at boot.
 */
export async function resolveChannelProvider(input: {
  channel: 'email' | 'sms';
  orgId?: string;
  integrations?: IntegrationsKit;
  platform?: NotificationProviders;
  fetchImpl?: typeof fetch;
}): Promise<{ provider: ChannelProvider | undefined; source: DeliverySource }> {
  const fallback =
    input.channel === 'email' ? input.platform?.email : input.platform?.sms;
  if (!input.integrations || !input.orgId) {
    return { provider: fallback, source: 'platform' };
  }
  const result = await input.integrations.resolveProvider<
    ChannelProvider | undefined
  >(
    input.orgId,
    input.channel === 'email' ? EMAIL_SEND_INTEGRATION : SMS_INTEGRATION,
    (config) =>
      input.channel === 'email'
        ? buildEmailProviderFromConfig(config, input.fetchImpl)
        : buildSmsProviderFromConfig(config, input.fetchImpl),
    () => fallback,
  );
  return {
    provider: result.provider,
    source: result.source === 'tenant' ? 'org' : 'platform',
  };
}

const TEST_SUBJECT = 'AgentOS test email';
const TEST_BODY =
  'This is a test message from AgentOS Settings. Your email sending integration works.';

/** `email.send` + `sms` definitions mounted at `/integrations/*`. */
export function notificationIntegrationDefinitions(input: {
  platform: NotificationProviders;
  fetchImpl?: typeof fetch;
}): IntegrationDefinition[] {
  const { platform, fetchImpl } = input;

  const emailSend: IntegrationDefinition = {
    id: EMAIL_SEND_INTEGRATION,
    label: 'Email sending',
    description:
      'Send email from your own Resend or Cloudflare account instead of the platform default.',
    providers: [
      {
        id: 'resend',
        label: 'Resend',
        settings: [
          {
            name: 'from',
            label: 'From address',
            required: true,
            placeholder: 'Acme <notifications@acme.com>',
            description: 'Must use a domain verified in your Resend account.',
          },
        ],
        secrets: [
          {
            name: 'apiKey',
            label: 'API key',
            required: true,
            placeholder: 're_…',
          },
        ],
      },
      {
        id: 'cloudflare',
        label: 'Cloudflare Email Sending',
        settings: [
          {
            name: 'from',
            label: 'From address',
            required: true,
            placeholder: 'notifications@acme.com',
            description:
              'Domain must be onboarded under Cloudflare Email Service.',
          },
          {
            name: 'accountId',
            label: 'Account ID',
            required: false,
            description:
              'Optional — auto-detected from your API token when left blank.',
          },
        ],
        secrets: [
          {
            name: 'apiToken',
            label: 'API token',
            required: true,
            description: 'Token with the Email Sending Write permission.',
          },
        ],
      },
    ],
    platformDefault: () => ({
      provider: platformName(platform.email),
      configured: true,
    }),
    async beforeSave({ existing, draft }) {
      if (draft.provider !== 'cloudflare') return draft;
      const existingAccountId =
        typeof draft.settings.accountId === 'string'
          ? draft.settings.accountId.trim()
          : '';
      if (existingAccountId) return draft;
      const token =
        (typeof draft.secrets.apiToken === 'string' &&
          draft.secrets.apiToken) ||
        (existing?.provider === 'cloudflare'
          ? existing.secrets.apiToken
          : '') ||
        '';
      const resolved = await resolveCloudflareAccountId(token, fetchImpl);
      if (!resolved.ok) {
        throw new IntegrationError(resolved.error, 400);
      }
      return {
        ...draft,
        settings: {
          ...draft.settings,
          accountId: resolved.accountId,
        },
      };
    },
    async test({ config, actor }) {
      let resolvedConfig = config;
      if (
        config?.provider === 'cloudflare' &&
        !setting(config, 'accountId') &&
        config.secrets.apiToken
      ) {
        const lookup = await resolveCloudflareAccountId(
          config.secrets.apiToken,
          fetchImpl,
        );
        if (!lookup.ok) {
          return { ok: false, message: lookup.error };
        }
        resolvedConfig = {
          ...config,
          settings: { ...config.settings, accountId: lookup.accountId },
        };
      }
      const provider = resolvedConfig
        ? buildEmailProviderFromConfig(resolvedConfig, fetchImpl)
        : platform.email;
      if (!actor || !actor.includes('@')) {
        return {
          ok: false,
          message: 'No email address for the current user to send a test to.',
        };
      }
      const result = await provider.send({
        to: actor,
        subject: TEST_SUBJECT,
        body: TEST_BODY,
      });
      return result.ok
        ? { ok: true, message: `Test email sent to ${actor}` }
        : { ok: false, message: result.error ?? 'Send failed' };
    },
  };

  const sms: IntegrationDefinition = {
    id: SMS_INTEGRATION,
    label: 'SMS',
    description:
      'Send SMS from your own Twilio account instead of the platform default.',
    providers: [
      {
        id: 'twilio',
        label: 'Twilio',
        settings: [
          {
            name: 'accountSid',
            label: 'Account SID',
            required: true,
            placeholder: 'AC…',
            description: 'Found on the Twilio Console dashboard.',
          },
          {
            name: 'apiKeySid',
            label: 'API key SID',
            required: true,
            placeholder: 'SK…',
            description:
              'Create a Standard API key in the Twilio Console under Account → API keys & tokens.',
          },
          {
            name: 'from',
            label: 'Default from number',
            required: false,
            placeholder: '+15551234567',
            description:
              'Used when a member has not picked their own number. Save your credentials first to load your Twilio numbers.',
          },
        ],
        secrets: [
          {
            name: 'apiKeySecret',
            label: 'API key secret',
            required: true,
            description:
              'Shown once when the key is created. Never use your master auth token here.',
          },
        ],
      },
    ],
    platformDefault: () => ({
      provider: platformName(platform.sms),
      configured: true,
    }),
    async beforeSave({ draft }) {
      if (draft.provider !== 'twilio') return draft;
      const accountSid = draftSetting(draft.settings.accountSid);
      const apiKeySid = draftSetting(draft.settings.apiKeySid);
      if (accountSid && !accountSid.startsWith('AC')) {
        throw new IntegrationError(
          'Account SID must start with "AC" (find it on the Twilio Console dashboard).',
          400,
        );
      }
      if (apiKeySid && !apiKeySid.startsWith('SK')) {
        throw new IntegrationError(
          'API key SID must start with "SK". Create an API key in the Twilio Console — do not paste your account auth token.',
          400,
        );
      }
      const from = draftSetting(draft.settings.from);
      if (from && !E164_PATTERN.test(from)) {
        throw new IntegrationError(
          'Default from number must be in E.164 format (e.g. +15551234567).',
          400,
        );
      }
      return draft;
    },
    async test({ config }) {
      const provider = config
        ? buildSmsProviderFromConfig(config, fetchImpl)
        : platform.sms;
      if (!provider.verify) {
        return {
          ok: true,
          message: 'Platform log sink — messages are printed, not delivered.',
        };
      }
      if (provider.listSenders) {
        const senders = await provider.listSenders();
        return senders.ok
          ? {
              ok: true,
              message: `Twilio API key verified — ${senders.numbers.length} SMS-capable number${senders.numbers.length === 1 ? '' : 's'} found`,
            }
          : { ok: false, message: senders.error };
      }
      const result = await provider.verify();
      return result.ok
        ? { ok: true, message: 'Twilio credentials verified' }
        : { ok: false, message: result.error ?? 'Verification failed' };
    },
  };

  return [emailSend, sms];
}

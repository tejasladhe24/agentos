import type {
  IntegrationDefinition,
  IntegrationsKit,
  ResolvedIntegration,
} from '@agentos/core/api/integrations';

import { createCloudflareEmailProvider } from './providers/cloudflare';
import type { NotificationProviders } from './providers/create-providers';
import { createResendProvider } from './providers/resend';
import { createTwilioProvider } from './providers/twilio';
import type { ChannelProvider } from './providers/types';

export const EMAIL_SEND_INTEGRATION = 'email.send';
export const SMS_INTEGRATION = 'sms';

export type DeliverySource = 'org' | 'platform';

const ORG_CONFIG_HINT = 'Check the provider settings in Settings.';

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
    authToken: config.secrets.authToken ?? '',
    from: setting(config, 'from'),
    fetchImpl,
    missingConfigError: `Twilio needs an account SID, auth token, and from number. ${ORG_CONFIG_HINT}`,
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
          { name: 'accountId', label: 'Account ID', required: true },
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
    async test({ config, actor }) {
      const provider = config
        ? buildEmailProviderFromConfig(config, fetchImpl)
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
          },
          {
            name: 'from',
            label: 'From number',
            required: true,
            placeholder: '+15551234567',
            description: 'E.164 number or messaging service sender.',
          },
        ],
        secrets: [{ name: 'authToken', label: 'Auth token', required: true }],
      },
    ],
    platformDefault: () => ({
      provider: platformName(platform.sms),
      configured: true,
    }),
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
      const result = await provider.verify();
      return result.ok
        ? { ok: true, message: 'Twilio credentials verified' }
        : { ok: false, message: result.error ?? 'Verification failed' };
    },
  };

  return [emailSend, sms];
}

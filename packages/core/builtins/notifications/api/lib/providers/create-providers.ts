import { createCloudflareEmailProvider } from './cloudflare';
import { createLogProvider } from './log';
import { createResendProvider } from './resend';
import { createTwilioProvider } from './twilio';
import type { ChannelProvider } from './types';

export type ProviderEnv = {
  emailProvider?: string;
  emailApiKey?: string;
  emailFrom?: string;
  /** Cloudflare account id (Email Sending REST). */
  emailAccountId?: string;
  smsProvider?: string;
  smsAccountSid?: string;
  smsAuthToken?: string;
  smsFrom?: string;
  fetchImpl?: typeof fetch;
};

export type NotificationProviders = {
  email: ChannelProvider;
  sms: ChannelProvider;
};

function createEmailProvider(env: ProviderEnv): ChannelProvider {
  const emailName = (env.emailProvider ?? 'log').toLowerCase();
  if (emailName === 'resend') {
    return createResendProvider({
      apiKey: env.emailApiKey ?? '',
      from: env.emailFrom ?? '',
      fetchImpl: env.fetchImpl,
    });
  }
  if (emailName === 'cloudflare') {
    return createCloudflareEmailProvider({
      accountId: env.emailAccountId ?? '',
      apiToken: env.emailApiKey ?? '',
      from: env.emailFrom ?? '',
      fetchImpl: env.fetchImpl,
    });
  }
  return createLogProvider('email');
}

/** Resolve email/SMS adapters from env (default: log sinks). */
export function createProviders(env: ProviderEnv = {}): NotificationProviders {
  const smsName = (env.smsProvider ?? 'log').toLowerCase();

  const email = createEmailProvider(env);

  const sms =
    smsName === 'twilio'
      ? createTwilioProvider({
          accountSid: env.smsAccountSid ?? '',
          authToken: env.smsAuthToken ?? '',
          from: env.smsFrom ?? '',
          fetchImpl: env.fetchImpl,
        })
      : createLogProvider('sms');

  return { email, sms };
}

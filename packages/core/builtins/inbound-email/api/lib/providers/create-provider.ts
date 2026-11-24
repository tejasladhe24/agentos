import { createFixtureProvider } from './fixture';
import { createResendInboundProvider } from './resend';
import type { InboundEmailProvider } from './types';

export type InboundProviderName = 'fixture' | 'resend';

export type CreateProviderInput = {
  provider: InboundProviderName;
  webhookSecret?: string;
  resendApiKey?: string;
  resendSigningSecret?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export function createInboundProvider(
  input: CreateProviderInput,
): InboundEmailProvider {
  if (input.provider === 'resend') {
    return createResendInboundProvider({
      apiKey: input.resendApiKey ?? '',
      signingSecret: input.resendSigningSecret ?? '',
      fetchImpl: input.fetchImpl,
    });
  }
  return createFixtureProvider({
    secret: input.webhookSecret ?? '',
  });
}

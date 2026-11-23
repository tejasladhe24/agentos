import { createFixtureProvider } from './fixture';
import { createMailgunProvider } from './mailgun';
import type { InboundEmailProvider } from './types';

export type CreateProviderInput = {
  provider: 'fixture' | 'mailgun';
  webhookSecret?: string;
  mailgunSigningKey?: string;
};

export function createInboundProvider(
  input: CreateProviderInput,
): InboundEmailProvider {
  if (input.provider === 'mailgun') {
    return createMailgunProvider({
      signingKey: input.mailgunSigningKey ?? input.webhookSecret ?? '',
    });
  }
  return createFixtureProvider({
    secret: input.webhookSecret ?? '',
  });
}

import type { ChannelProvider, SendPayload, SendResult } from './types';

export type ResendConfig = {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
};

/** Resend HTTP email adapter. */
export function createResendProvider(config: ResendConfig): ChannelProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    name: 'resend',
    async send(payload: SendPayload): Promise<SendResult> {
      if (!config.apiKey || !config.from) {
        return {
          ok: false,
          provider: 'resend',
          error:
            'Resend requires AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY and EMAIL_FROM',
        };
      }
      try {
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to: [payload.to],
            subject: payload.subject ?? '(no subject)',
            text: payload.body,
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return {
            ok: false,
            provider: 'resend',
            error: `Resend ${res.status}: ${detail || res.statusText}`,
          };
        }
        return { ok: true, provider: 'resend' };
      } catch (error) {
        return {
          ok: false,
          provider: 'resend',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

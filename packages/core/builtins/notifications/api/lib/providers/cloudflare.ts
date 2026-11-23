import type { ChannelProvider, SendPayload, SendResult } from './types';

export type CloudflareEmailConfig = {
  /** Cloudflare account id (path segment). */
  accountId: string;
  /** API token with Email Sending Write. */
  apiToken: string;
  from: string;
  fetchImpl?: typeof fetch;
};

/**
 * Cloudflare Email Sending REST adapter.
 * POST /accounts/{account_id}/email/sending/send
 * @see https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */
export function createCloudflareEmailProvider(
  config: CloudflareEmailConfig,
): ChannelProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    name: 'cloudflare',
    async send(payload: SendPayload): Promise<SendResult> {
      if (!config.accountId || !config.apiToken || !config.from) {
        return {
          ok: false,
          provider: 'cloudflare',
          error:
            'Cloudflare email requires AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID, EMAIL_API_KEY, and EMAIL_FROM',
        };
      }
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`;
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to: payload.to,
            subject: payload.subject ?? '(no subject)',
            text: payload.body,
          }),
        });
        const detail = await res.text();
        if (!res.ok) {
          return {
            ok: false,
            provider: 'cloudflare',
            error: `Cloudflare ${res.status}: ${detail || res.statusText}`,
          };
        }
        try {
          const parsed = JSON.parse(detail) as {
            success?: boolean;
            errors?: Array<{ message?: string }>;
          };
          if (parsed.success === false) {
            const msg =
              parsed.errors
                ?.map((e) => e.message)
                .filter(Boolean)
                .join('; ') || detail;
            return {
              ok: false,
              provider: 'cloudflare',
              error: `Cloudflare API: ${msg}`,
            };
          }
        } catch {
          // Non-JSON success body — treat HTTP ok as success.
        }
        return { ok: true, provider: 'cloudflare' };
      } catch (error) {
        return {
          ok: false,
          provider: 'cloudflare',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

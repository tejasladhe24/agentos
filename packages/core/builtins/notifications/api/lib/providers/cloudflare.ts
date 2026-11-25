import {
  describeProviderFailure,
  type ChannelProvider,
  type SendPayload,
  type SendResult,
} from './types';

export type CloudflareEmailConfig = {
  /** Cloudflare account id (path segment). */
  accountId: string;
  /** API token with Email Sending Write. */
  apiToken: string;
  from: string;
  fetchImpl?: typeof fetch;
  missingConfigError?: string;
};

export type CloudflareAccountLookupResult =
  { ok: true; accountId: string } | { ok: false; error: string };

/**
 * Auto-resolve the Cloudflare account id from an API token via
 * `GET /client/v4/accounts`. Succeeds when the token maps to a single account.
 */
export async function resolveCloudflareAccountId(
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudflareAccountLookupResult> {
  if (!apiToken.trim()) {
    return { ok: false, error: 'Cloudflare API token is required.' };
  }
  try {
    const res = await fetchImpl(
      'https://api.cloudflare.com/client/v4/accounts?per_page=2',
      {
        headers: { authorization: `Bearer ${apiToken}` },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error:
          'Could not auto-detect Cloudflare Account ID from this token — enter Account ID manually.',
      };
    }
    const body = (await res.json()) as {
      success?: boolean;
      result?: Array<{ id?: string }>;
    };
    const accounts = (body.result ?? []).filter(
      (a): a is { id: string } => typeof a?.id === 'string' && a.id.length > 0,
    );
    if (accounts.length === 1) {
      return { ok: true, accountId: accounts[0]!.id };
    }
    if (accounts.length > 1) {
      return {
        ok: false,
        error:
          'Multiple Cloudflare accounts found for this token — enter Account ID manually.',
      };
    }
    return {
      ok: false,
      error:
        'Could not auto-detect Cloudflare Account ID from this token — enter Account ID manually.',
    };
  } catch {
    return {
      ok: false,
      error:
        'Could not reach Cloudflare API to auto-detect Account ID — enter Account ID manually.',
    };
  }
}

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
      const from = payload.from?.trim() || config.from;
      if (!config.accountId || !config.apiToken || !from) {
        return {
          ok: false,
          provider: 'cloudflare',
          error:
            config.missingConfigError ??
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
            from,
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
            error: describeProviderFailure(
              'Cloudflare',
              res.status,
              detail || res.statusText,
            ),
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
    /** GET /accounts/{id}/tokens/verify — confirms the token is active. */
    async verify(): Promise<SendResult> {
      if (!config.accountId || !config.apiToken) {
        return {
          ok: false,
          provider: 'cloudflare',
          error:
            config.missingConfigError ??
            'Cloudflare account id and token required',
        };
      }
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/tokens/verify`;
      try {
        const res = await fetchImpl(url, {
          headers: { authorization: `Bearer ${config.apiToken}` },
        });
        if (!res.ok) {
          const detail = await res.text();
          return {
            ok: false,
            provider: 'cloudflare',
            error: describeProviderFailure(
              'Cloudflare',
              res.status,
              detail || res.statusText,
            ),
          };
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

import {
  toStoredTokens,
  type OAuthStoredTokens,
  type OAuthTokenResponse,
} from '@agentos/core/api/oauth';

import { BlobStoreError, MountReconnectError } from './blob-store-error';
import type { MountCredentials } from './storage-providers';

const MAX_BACKOFF_MS = 16_000;

export type OAuthHttpClientOptions = {
  /** Provider id stored on refreshed tokens. */
  provider: string;
  /** Product name for error messages (`Google Drive`, `OneDrive`). */
  label: string;
  /** Sign-in service name for refresh errors (`Google`, `Microsoft`). */
  signInLabel: string;
  tokenUrl: string;
  /** Extra form fields sent with refresh (e.g. Microsoft `scope`). */
  refreshParams?: Record<string, string>;
  reconnectMessage: string;
  /** Rate limits / transient failures worth a backoff retry. */
  shouldRetry: (res: Response) => Promise<boolean>;
  credentials: MountCredentials;
  client: { clientId: string; clientSecret: string };
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Retries after the first attempt on rate limits / 5xx. */
  maxRetries?: number;
};

export type OAuthHttpClient = {
  /** Authorized request with refresh on 401 and backoff on rate limits. */
  request: (url: string, init?: RequestInit) => Promise<Response>;
  /** Unauthenticated request with the same backoff (pre-signed URLs). */
  requestUnsigned: (url: string, init?: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
};

export function retryDelay(res: Response | null, attempt: number): number {
  const header = res?.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Personal-mount HTTP client: token refresh, reconnect on revoke, backoff. */
export function createOAuthHttpClient(
  options: OAuthHttpClientOptions,
): OAuthHttpClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRetries ?? 4;
  let tokens: OAuthStoredTokens | undefined;
  let refreshing: Promise<string> | null = null;

  async function reconnect(): Promise<MountReconnectError> {
    await options.credentials
      .revoked(options.reconnectMessage)
      .catch(() => undefined);
    return new MountReconnectError(options.reconnectMessage);
  }

  async function current(): Promise<OAuthStoredTokens> {
    tokens ??= await options.credentials.load();
    if (!tokens) throw await reconnect();
    return tokens;
  }

  function expiring(t: OAuthStoredTokens): boolean {
    if (!t.expiresAt) return false;
    return Date.parse(t.expiresAt) - 60_000 <= now();
  }

  async function doRefresh(): Promise<string> {
    const t = await current();
    if (!t.refreshToken) throw await reconnect();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: t.refreshToken,
      client_id: options.client.clientId,
      client_secret: options.client.clientSecret,
      ...options.refreshParams,
    });
    let res: Response;
    try {
      res = await fetchImpl(options.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw new BlobStoreError(
        `${options.signInLabel} sign-in is unreachable`,
        502,
      );
    }
    if (res.status === 400 || res.status === 401) {
      // invalid_grant: revoked, expired, password reset, or consent withdrawn.
      throw await reconnect();
    }
    if (!res.ok) {
      throw new BlobStoreError(
        `${options.signInLabel} token refresh failed (${res.status})`,
        502,
      );
    }
    const raw = (await res.json()) as OAuthTokenResponse;
    const { raw: _raw, ...stored } = toStoredTokens(raw, {
      provider: options.provider,
      nowMs: now(),
    });
    const next: OAuthStoredTokens = {
      ...stored,
      refreshToken: raw.refresh_token ?? t.refreshToken,
    };
    tokens = next;
    await options.credentials.save(next);
    return next.accessToken;
  }

  function refresh(): Promise<string> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function accessToken(): Promise<string> {
    const t = await current();
    return expiring(t) ? refresh() : t.accessToken;
  }

  async function send(
    url: string,
    init: RequestInit,
    signed: boolean,
  ): Promise<Response> {
    let token = signed ? await accessToken() : '';
    let refreshed = false;
    let attempt = 0;
    for (;;) {
      const headers = new Headers(init.headers);
      if (signed) headers.set('authorization', `Bearer ${token}`);
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(retryDelay(null, attempt));
          attempt += 1;
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new BlobStoreError(
          `${options.label} is unreachable: ${detail}`,
          502,
        );
      }
      if (signed && res.status === 401 && !refreshed) {
        refreshed = true;
        token = await refresh();
        continue;
      }
      if (signed && res.status === 401) throw await reconnect();
      if (attempt < maxRetries && (await options.shouldRetry(res))) {
        await sleep(retryDelay(res, attempt));
        attempt += 1;
        continue;
      }
      return res;
    }
  }

  return {
    request: (url, init = {}) => send(url, init, true),
    requestUnsigned: (url, init = {}) => send(url, init, false),
    sleep,
  };
}

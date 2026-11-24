import {
  toStoredTokens,
  type OAuthStoredTokens,
  type OAuthTokenResponse,
} from '@agentos/core/api/oauth';

import { BlobStoreError, MountReconnectError } from './blob-store-error';
import type { MountCredentials } from './storage-providers';

export const GOOGLE_AUTHORIZE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export const DRIVE_RECONNECT_MESSAGE =
  'Google Drive access expired or was revoked — reconnect it in Settings › Files.';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const MAX_BACKOFF_MS = 16_000;

export type DriveClientOptions = {
  credentials: MountCredentials;
  client: { clientId: string; clientSecret: string };
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Retries after the first attempt on 429 / rate-limit 403 / 5xx. */
  maxRetries?: number;
};

export type DriveClient = {
  /** Authorized request with refresh on 401 and backoff on rate limits. */
  request: (url: string, init?: RequestInit) => Promise<Response>;
  json: <T>(
    url: string,
    init: RequestInit | undefined,
    op: string,
  ) => Promise<T>;
};

type DriveErrorBody = {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

async function errorReason(res: Response): Promise<{
  reason?: string;
  message?: string;
}> {
  try {
    const body = (await res.clone().json()) as DriveErrorBody;
    return {
      reason: body.error?.errors?.[0]?.reason,
      message: body.error?.message,
    };
  } catch {
    return {};
  }
}

/** Map a failed Drive response onto a Files error with a readable message. */
export async function driveError(
  res: Response,
  op: string,
): Promise<BlobStoreError> {
  const { reason, message } = await errorReason(res);
  if (res.status === 404) return new BlobStoreError('not found', 404);
  if (reason === 'storageQuotaExceeded') {
    return new BlobStoreError('Google Drive storage is full', 507);
  }
  if (reason === 'exportSizeLimitExceeded') {
    return new BlobStoreError(
      'document is too large for Google to export (10 MB limit) — open it in Google instead',
      413,
    );
  }
  if (res.status === 403) {
    return new BlobStoreError(
      `Google Drive denied ${op}${message ? `: ${message}` : ''}`,
      403,
    );
  }
  return new BlobStoreError(
    `Google Drive ${op} failed (${res.status})${message ? `: ${message}` : ''}`,
    502,
  );
}

function retryDelay(res: Response | null, attempt: number): number {
  const header = res?.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
}

async function shouldRetry(res: Response): Promise<boolean> {
  if (RETRYABLE_STATUS.has(res.status)) return true;
  if (res.status !== 403) return false;
  const { reason } = await errorReason(res);
  return reason !== undefined && RATE_LIMIT_REASONS.has(reason);
}

export function createDriveClient(options: DriveClientOptions): DriveClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const now = options.now ?? Date.now;
  const maxRetries = options.maxRetries ?? 4;
  let tokens: OAuthStoredTokens | undefined;
  let refreshing: Promise<string> | null = null;

  async function reconnect(): Promise<MountReconnectError> {
    await options.credentials
      .revoked(DRIVE_RECONNECT_MESSAGE)
      .catch(() => undefined);
    return new MountReconnectError(DRIVE_RECONNECT_MESSAGE);
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
    });
    let res: Response;
    try {
      res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw new BlobStoreError('Google sign-in is unreachable', 502);
    }
    if (res.status === 400 || res.status === 401) {
      // invalid_grant: revoked, expired (7-day testing apps), or password reset.
      throw await reconnect();
    }
    if (!res.ok) {
      throw new BlobStoreError(
        `Google token refresh failed (${res.status})`,
        502,
      );
    }
    const raw = (await res.json()) as OAuthTokenResponse;
    const { raw: _raw, ...stored } = toStoredTokens(raw, {
      provider: 'google-drive',
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

  async function request(url: string, init: RequestInit = {}) {
    let token = await accessToken();
    let refreshed = false;
    let attempt = 0;
    for (;;) {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
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
        throw new BlobStoreError(`Google Drive is unreachable: ${detail}`, 502);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await refresh();
        continue;
      }
      if (res.status === 401) throw await reconnect();
      if (attempt < maxRetries && (await shouldRetry(res))) {
        await sleep(retryDelay(res, attempt));
        attempt += 1;
        continue;
      }
      return res;
    }
  }

  return {
    request,
    async json<T>(url: string, init: RequestInit | undefined, op: string) {
      const res = await request(url, init);
      if (!res.ok) throw await driveError(res, op);
      return (await res.json()) as T;
    },
  };
}

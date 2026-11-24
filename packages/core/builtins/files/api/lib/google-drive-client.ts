import { BlobStoreError } from './blob-store-error';
import { createOAuthHttpClient } from './oauth-http-client';
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

async function shouldRetry(res: Response): Promise<boolean> {
  if (RETRYABLE_STATUS.has(res.status)) return true;
  if (res.status !== 403) return false;
  const { reason } = await errorReason(res);
  return reason !== undefined && RATE_LIMIT_REASONS.has(reason);
}

export function createDriveClient(options: DriveClientOptions): DriveClient {
  const http = createOAuthHttpClient({
    ...options,
    provider: 'google-drive',
    label: 'Google Drive',
    signInLabel: 'Google',
    tokenUrl: GOOGLE_TOKEN_URL,
    reconnectMessage: DRIVE_RECONNECT_MESSAGE,
    shouldRetry,
  });
  return {
    request: http.request,
    async json<T>(url: string, init: RequestInit | undefined, op: string) {
      const res = await http.request(url, init);
      if (!res.ok) throw await driveError(res, op);
      return (await res.json()) as T;
    },
  };
}

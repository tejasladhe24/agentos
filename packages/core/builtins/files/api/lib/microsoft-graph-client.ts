import { BlobStoreError } from './blob-store-error';
import { createOAuthHttpClient } from './oauth-http-client';
import type { MountCredentials } from './storage-providers';

export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
export const GRAPH_API = `${GRAPH_ORIGIN}/v1.0`;

export const ONEDRIVE_RECONNECT_MESSAGE =
  'OneDrive access expired or was revoked — reconnect it in Settings › Files.';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 509]);

export function microsoftAuthority(tenant: string): {
  authorizeUrl: string;
  tokenUrl: string;
} {
  const base = `${MICROSOFT_LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  return { authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token` };
}

export type GraphClientOptions = {
  credentials: MountCredentials;
  client: { clientId: string; clientSecret: string };
  tokenUrl: string;
  scopes: readonly string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
};

export type GraphClient = {
  /** Authorized Graph request (refresh on 401, backoff on 429 / 5xx). */
  request: (url: string, init?: RequestInit) => Promise<Response>;
  /** Pre-authenticated URLs (upload sessions, downloads, copy monitors). */
  requestUnsigned: (url: string, init?: RequestInit) => Promise<Response>;
  json: <T>(
    url: string,
    init: RequestInit | undefined,
    op: string,
  ) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
};

type GraphErrorBody = { error?: { code?: string; message?: string } };

/** Map a failed Graph response onto a Files error with a readable message. */
export async function graphError(
  res: Response,
  op: string,
): Promise<BlobStoreError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = (await res.clone().json()) as GraphErrorBody;
    code = body.error?.code;
    message = body.error?.message;
  } catch {
    // non-JSON body
  }
  if (res.status === 404) return new BlobStoreError('not found', 404);
  if (res.status === 507 || code === 'quotaLimitReached') {
    return new BlobStoreError('OneDrive storage is full', 507);
  }
  if (res.status === 423 || code === 'resourceLocked') {
    return new BlobStoreError(
      'the file is locked (open or checked out in Microsoft 365)',
      423,
    );
  }
  if (res.status === 409 || code === 'nameAlreadyExists') {
    return new BlobStoreError(
      `OneDrive ${op} conflict${message ? `: ${message}` : ''}`,
      409,
    );
  }
  if (res.status === 400) {
    return new BlobStoreError(
      `OneDrive rejected ${op}${message ? `: ${message}` : ''}`,
      400,
    );
  }
  if (res.status === 403) {
    return new BlobStoreError(
      `OneDrive denied ${op}${message ? `: ${message}` : ''}`,
      403,
    );
  }
  return new BlobStoreError(
    `OneDrive ${op} failed (${res.status})${message ? `: ${message}` : ''}`,
    502,
  );
}

export function createGraphClient(options: GraphClientOptions): GraphClient {
  const http = createOAuthHttpClient({
    ...options,
    provider: 'onedrive',
    label: 'OneDrive',
    signInLabel: 'Microsoft',
    reconnectMessage: ONEDRIVE_RECONNECT_MESSAGE,
    // Microsoft rotates refresh tokens and expects the scope on refresh.
    refreshParams: { scope: options.scopes.join(' ') },
    shouldRetry: async (res) => RETRYABLE_STATUS.has(res.status),
  });
  return {
    request: http.request,
    requestUnsigned: http.requestUnsigned,
    sleep: http.sleep,
    async json<T>(url: string, init: RequestInit | undefined, op: string) {
      const res = await http.request(url, init);
      if (!res.ok) throw await graphError(res, op);
      return (await res.json()) as T;
    },
  };
}

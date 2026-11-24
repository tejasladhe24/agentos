import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
import type { BlobListOptions, BlobListResult, StorageAdapter } from './types';

/** Vercel Blob REST API (mirrors `@vercel/blob`). */
export const VERCEL_BLOB_API_URL = 'https://vercel.com/api/blob';
export const VERCEL_BLOB_API_VERSION = '13';

export type VercelBlobAccess = 'public' | 'private';

export type VercelBlobStoreConfig = {
  /** `vercel_blob_rw_<storeId>_<secret>` read-write token. */
  token: string;
  access: VercelBlobAccess;
  /** Override the store id parsed from the token. */
  storeId?: string;
  /** Key prefix used by `test()` for the probe object. */
  probePrefix?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
};

type ApiBlob = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

type ApiError = { error?: { code?: string; message?: string } };

export function storeIdFromToken(token: string): string {
  const [, , , storeId = ''] = token.split('_');
  return storeId;
}

function normalizeStoreId(storeId: string): string {
  return storeId.startsWith('store_')
    ? storeId.slice('store_'.length)
    : storeId;
}

/** Human message for a Vercel Blob API error code. */
export function describeVercelBlobError(
  code: string,
  message?: string,
): string {
  switch (code) {
    case 'forbidden':
      return 'read-write token was rejected (check the token and store)';
    case 'store_not_found':
      return 'blob store does not exist';
    case 'store_suspended':
      return 'blob store is suspended';
    case 'file_too_large':
      return `file is too large${message ? `: ${message}` : ''}`;
    case 'rate_limited':
      return 'Vercel Blob rate limit reached; try again shortly';
    case 'bad_request':
      return message ?? 'request rejected by Vercel Blob';
    default:
      return message ?? `Vercel Blob error (${code})`;
  }
}

function encodePathname(pathname: string): string {
  return pathname.split('/').map(encodeURIComponent).join('/');
}

export function createVercelBlobStore(
  config: VercelBlobStoreConfig,
): StorageAdapter {
  const token = config.token.trim();
  if (!token.startsWith('vercel_blob_rw_')) {
    throw new BlobStoreError(
      'read-write token must start with vercel_blob_rw_',
      400,
    );
  }
  const storeId = normalizeStoreId(
    config.storeId?.trim() || storeIdFromToken(token),
  );
  if (!/^[a-zA-Z0-9]{4,64}$/.test(storeId)) {
    throw new BlobStoreError('could not read the store id from the token', 400);
  }
  const access = config.access;
  const apiUrl = (config.apiUrl ?? VERCEL_BLOB_API_URL).replace(/\/+$/, '');
  const fetchImpl = config.fetch ?? fetch;

  function headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers(extra);
    h.set('authorization', `Bearer ${token}`);
    h.set('x-api-version', VERCEL_BLOB_API_VERSION);
    return h;
  }

  async function api<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(`${apiUrl}${path}`, init);
    if (!res.ok) {
      let code = res.status === 403 ? 'forbidden' : 'unknown_error';
      let message: string | undefined;
      try {
        const body = (await res.json()) as ApiError;
        code = body.error?.code ?? code;
        message = body.error?.message;
      } catch {
        // non-JSON error body
      }
      throw new BlobStoreError(
        describeVercelBlobError(code, message),
        code === 'not_found' ? 404 : code === 'file_too_large' ? 413 : 502,
      );
    }
    return (await res.json()) as T;
  }

  function writeHeaders(contentType?: string): Headers {
    const h = headers({
      'x-vercel-blob-access': access,
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '60',
    });
    if (contentType) h.set('x-content-type', contentType);
    return h;
  }

  return {
    provider: 'vercel-blob',
    label: `vercel-blob://${storeId}`,
    indexMode: 'indexed',
    capabilities: {
      serverSideCopy: true,
      nativeFolders: false,
      nativeTrash: false,
      versions: false,
      maxFileSize: MAX_OBJECT_BYTES,
      exportFormats: [],
      quota: false,
    },

    async put(key, bytes, options) {
      const pathname = normalizeBlobKey(key);
      const params = new URLSearchParams({ pathname });
      await api(`/?${params.toString()}`, {
        method: 'PUT',
        headers: writeHeaders(options?.contentType),
        body: bytes,
      });
    },

    async get(key) {
      const pathname = normalizeBlobKey(key);
      const url = new URL(
        `https://${storeId}.${access}.blob.vercel-storage.com/${encodePathname(pathname)}`,
      );
      if (access === 'private') url.searchParams.set('cache', '0');
      const res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new BlobStoreError(
          res.status === 403
            ? describeVercelBlobError('forbidden')
            : `Vercel Blob read failed (${res.status})`,
          502,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      const pathname = normalizeBlobKey(key);
      await api('/delete', {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ urls: [pathname] }),
      });
    },

    async list(options: BlobListOptions): Promise<BlobListResult> {
      const prefix = options.prefix.replace(/^\/+/, '');
      const params = new URLSearchParams();
      params.set(
        'limit',
        String(Math.max(1, Math.min(options.limit ?? 100, 1000))),
      );
      if (prefix) params.set('prefix', prefix);
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.delimiter === '/') params.set('mode', 'folded');
      const res = await api<{
        blobs?: ApiBlob[];
        folders?: string[];
        cursor?: string;
        hasMore?: boolean;
      }>(`?${params.toString()}`, { method: 'GET', headers: headers() });
      return {
        objects: (res.blobs ?? [])
          // `createFolder` placeholders end with `/`.
          .filter((b) => b.pathname && !b.pathname.endsWith('/'))
          .map((b) => ({
            key: b.pathname,
            bytes: b.size,
            updatedAt: b.uploadedAt,
          })),
        prefixes: res.folders ?? [],
        cursor: res.hasMore ? (res.cursor ?? null) : null,
      };
    },

    async copy(fromKey, toKey) {
      const from = normalizeBlobKey(fromKey);
      const to = normalizeBlobKey(toKey);
      if (from === to) return;
      const params = new URLSearchParams({ pathname: to, fromUrl: from });
      await api(`?${params.toString()}`, {
        method: 'PUT',
        headers: writeHeaders(),
      });
    },

    /** Upload, list, and delete a probe blob under the mount prefix. */
    async test() {
      const root = (config.probePrefix ?? '').replace(/^\/+/, '');
      const probe = `${root}.agentos-probe-${crypto.randomUUID()}`;
      await this.put(probe, new TextEncoder().encode('agentos'), {
        contentType: 'text/plain',
      });
      await this.list({ prefix: root, limit: 1, delimiter: '/' });
      await this.delete(probe);
    },
  };
}

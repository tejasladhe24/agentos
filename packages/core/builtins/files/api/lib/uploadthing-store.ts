import { UTApi, UTFile } from 'uploadthing/server';

import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
import type { BlobListOptions, BlobListResult, StorageAdapter } from './types';

/** AgentOS-managed files carry this customId prefix. */
export const UPLOADTHING_CUSTOM_ID_PREFIX = 'agentos_';
const LISTING_TTL_MS = 10_000;
const LIST_PAGE = 500;

export type UploadThingToken = {
  apiKey: string;
  appId: string;
  regions: string[];
};

export type UploadThingStoreConfig = {
  /** `UPLOADTHING_TOKEN` (base64 JSON `{ apiKey, appId, regions }`). */
  token: string;
  probePrefix?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

type ListedFile = {
  key: string;
  name: string;
  size: number;
  uploadedAt: number;
};

/** Decode and validate an UploadThing v7 token. */
export function parseUploadThingToken(raw: string): UploadThingToken {
  let parsed: Partial<UploadThingToken>;
  try {
    parsed = JSON.parse(atob(raw.trim())) as Partial<UploadThingToken>;
  } catch {
    throw new BlobStoreError(
      'invalid UploadThing token: copy UPLOADTHING_TOKEN from the dashboard (API Keys)',
      400,
    );
  }
  if (
    typeof parsed.apiKey !== 'string' ||
    !parsed.apiKey.startsWith('sk_') ||
    typeof parsed.appId !== 'string' ||
    !parsed.appId ||
    !Array.isArray(parsed.regions) ||
    parsed.regions.length === 0
  ) {
    throw new BlobStoreError(
      'invalid UploadThing token: expected { apiKey, appId, regions }',
      400,
    );
  }
  return {
    apiKey: parsed.apiKey,
    appId: parsed.appId,
    regions: parsed.regions.map(String),
  };
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.response?.status === 'number') return e.response.status;
  return e.cause && e.cause !== error ? statusOf(e.cause) : undefined;
}

/** Human message for an UploadThing SDK failure. */
export function describeUploadThingError(error: unknown, op: string): string {
  const status = statusOf(error);
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  if (status === 401 || status === 403 || code === 'FORBIDDEN') {
    return 'UploadThing rejected the API key (check the token and app)';
  }
  if (code === 'INVALID_SERVER_CONFIG') {
    return 'invalid UploadThing token';
  }
  if (status === 429 || code === 'TOO_MANY_REQUESTS') {
    return 'UploadThing rate limit reached; try again shortly';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `UploadThing ${op} failed: ${message}`;
}

async function guarded<T>(op: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BlobStoreError) throw error;
    throw new BlobStoreError(describeUploadThingError(error, op), 502);
  }
}

/**
 * UploadThing is flat (file keys, no folders). The AgentOS path is the file
 * name; folders are virtual and derived from names. Paths resolve to file
 * keys through a short-lived listing cache.
 */
export function createUploadThingStore(
  config: UploadThingStoreConfig,
): StorageAdapter {
  const token = parseUploadThingToken(config.token);
  const now = config.now ?? (() => Date.now());
  const utapi = new UTApi({
    token: config.token.trim(),
    logLevel: 'None',
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  const fetchImpl = config.fetch ?? fetch;
  let listing: { at: number; byName: Map<string, ListedFile> } | null = null;

  async function load(force = false): Promise<Map<string, ListedFile>> {
    if (!force && listing && now() - listing.at < LISTING_TTL_MS) {
      return listing.byName;
    }
    const byName = new Map<string, ListedFile>();
    let offset = 0;
    for (;;) {
      const page = await guarded('list', () =>
        utapi.listFiles({ limit: LIST_PAGE, offset }),
      );
      for (const file of page.files) {
        if (file.status !== 'Uploaded') continue;
        if (!file.customId?.startsWith(UPLOADTHING_CUSTOM_ID_PREFIX)) continue;
        const prior = byName.get(file.name);
        if (!prior || prior.uploadedAt < file.uploadedAt) {
          byName.set(file.name, {
            key: file.key,
            name: file.name,
            size: file.size,
            uploadedAt: file.uploadedAt,
          });
        }
      }
      if (!page.hasMore || page.files.length === 0) break;
      offset += page.files.length;
    }
    listing = { at: now(), byName };
    return byName;
  }

  async function find(path: string): Promise<ListedFile | undefined> {
    return (await load()).get(path) ?? (await load(true)).get(path);
  }

  async function upload(
    path: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    const file = new UTFile([bytes], path, {
      type: contentType || 'application/octet-stream',
      customId: `${UPLOADTHING_CUSTOM_ID_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`,
    });
    const result = await guarded('upload', () => utapi.uploadFiles(file));
    if (result.error) {
      throw new BlobStoreError(
        describeUploadThingError(result.error, 'upload'),
        502,
      );
    }
  }

  async function removeKeys(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await guarded('delete', () => utapi.deleteFiles(keys));
  }

  const adapter: StorageAdapter = {
    provider: 'uploadthing',
    label: `uploadthing://${token.appId}`,
    indexMode: 'indexed',
    capabilities: {
      serverSideCopy: false,
      nativeFolders: false,
      nativeTrash: false,
      versions: false,
      maxFileSize: MAX_OBJECT_BYTES,
      exportFormats: [],
      quota: false,
    },

    async put(key, bytes, options) {
      const path = normalizeBlobKey(key);
      const existing = (await load(true)).get(path);
      await upload(path, bytes, options?.contentType);
      if (existing) await removeKeys([existing.key]);
      listing = null;
    },

    async get(key) {
      const path = normalizeBlobKey(key);
      const file = await find(path);
      if (!file) return null;
      const { ufsUrl } = await guarded('read', () =>
        utapi.generateSignedURL(file.key, { expiresIn: 300 }),
      );
      const res = await fetchImpl(ufsUrl);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new BlobStoreError(
          `UploadThing read failed (${res.status})`,
          502,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      const path = normalizeBlobKey(key);
      const file = await find(path);
      if (file) await removeKeys([file.key]);
      listing = null;
    },

    async list(options: BlobListOptions): Promise<BlobListResult> {
      const prefix = options.prefix.replace(/^\/+/, '');
      const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
      const files = await load();
      const names = [...files.keys()]
        .filter((name) => name.startsWith(prefix))
        .sort();
      const objects: BlobListResult['objects'] = [];
      const prefixes = new Set<string>();
      for (const name of names) {
        const rest = name.slice(prefix.length);
        const slash = options.delimiter === '/' ? rest.indexOf('/') : -1;
        if (slash >= 0) {
          prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
          continue;
        }
        const file = files.get(name)!;
        objects.push({
          key: name,
          bytes: file.size,
          updatedAt: new Date(file.uploadedAt).toISOString(),
        });
      }
      const start = options.cursor ? Number(options.cursor) || 0 : 0;
      const page = objects.slice(start, start + limit);
      const next =
        start + limit < objects.length ? String(start + limit) : null;
      return {
        objects: page,
        prefixes: start === 0 ? [...prefixes] : [],
        cursor: next,
      };
    },

    async copy(fromKey, toKey) {
      const from = normalizeBlobKey(fromKey);
      const to = normalizeBlobKey(toKey);
      if (from === to) return;
      const bytes = await adapter.get(from);
      if (!bytes) throw new BlobStoreError('not found', 404);
      await adapter.put(to, bytes);
    },

    /** Rename in place — the file key (and bytes) stay the same. */
    async move(fromKey, toKey) {
      const from = normalizeBlobKey(fromKey);
      const to = normalizeBlobKey(toKey);
      if (from === to) return;
      const file = await find(from);
      if (!file) throw new BlobStoreError('not found', 404);
      const replaced = (await load()).get(to);
      await guarded('rename', () =>
        utapi.renameFiles({ fileKey: file.key, newName: to }),
      );
      if (replaced && replaced.key !== file.key) {
        await removeKeys([replaced.key]);
      }
      listing = null;
    },

    /** Upload, list, and delete a probe file. */
    async test() {
      const root = (config.probePrefix ?? '').replace(/^\/+/, '');
      const probe = `${root}.agentos-probe-${crypto.randomUUID()}`;
      await upload(probe, new TextEncoder().encode('agentos'), 'text/plain');
      const file = (await load(true)).get(probe);
      if (!file) {
        throw new BlobStoreError(
          'UploadThing accepted the probe upload but it is not listed yet',
          502,
        );
      }
      await removeKeys([file.key]);
      listing = null;
    },
  };
  return adapter;
}

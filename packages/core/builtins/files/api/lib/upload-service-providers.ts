import { BlobStoreError } from './blob-store-error';
import { normalizeBlobKey } from './normalize-key';
import type { StorageProviderDefinition } from './storage-providers';
import {
  createUploadThingStore,
  parseUploadThingToken,
} from './uploadthing-store';
import {
  createVercelBlobStore,
  storeIdFromToken,
  type VercelBlobAccess,
} from './vercel-blob-store';

export type UploadServiceProviderOptions = {
  /** Test injection — fetch for provider APIs. */
  fetch?: typeof fetch;
};

function mountPrefix(config: Record<string, unknown>): string {
  const raw = config.prefix;
  if (typeof raw !== 'string' || !raw.replace(/\/+/g, '').trim()) return '';
  return `${normalizeBlobKey(raw)}/`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const PREFIX_FIELD = {
  id: 'prefix',
  label: 'Folder prefix',
  type: 'text',
  placeholder: 'optional/sub/path',
  help: 'Mount only this path inside the store.',
} as const;

/** UploadThing app as an org mount (`files.mount` / `uploadthing`). */
export function createUploadThingProvider(
  options: UploadServiceProviderOptions = {},
): StorageProviderDefinition {
  return {
    id: 'uploadthing',
    label: 'UploadThing',
    icon: 'UploadSimple',
    orgAddable: true,
    locationFields: ['appId', 'prefix'],
    secretFields: ['token'],
    fields: [
      {
        id: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
        placeholder: 'abc123xyz',
        help: 'Dashboard › API Keys. The token must belong to this app.',
      },
      PREFIX_FIELD,
      {
        id: 'token',
        label: 'UPLOADTHING_TOKEN',
        type: 'secret',
        required: true,
        help: 'Dashboard › API Keys › copy the V7 token.',
      },
    ],
    create(mount, ctx) {
      const config = mount.config ?? {};
      const raw = ctx.secrets.token?.trim();
      if (!raw) throw new BlobStoreError('UploadThing token is required', 400);
      const token = parseUploadThingToken(raw);
      const appId = text(config.appId);
      if (!appId)
        throw new BlobStoreError('UploadThing app ID is required', 400);
      if (token.appId !== appId) {
        throw new BlobStoreError(
          `token belongs to app ${token.appId}, not ${appId}`,
          400,
        );
      }
      return createUploadThingStore({
        token: raw,
        probePrefix: mountPrefix(config),
        fetch: options.fetch,
      });
    },
  };
}

/** Vercel Blob store as an org mount (`files.mount` / `vercel-blob`). */
export function createVercelBlobProvider(
  options: UploadServiceProviderOptions = {},
): StorageProviderDefinition {
  return {
    id: 'vercel-blob',
    label: 'Vercel Blob',
    icon: 'Triangle',
    orgAddable: true,
    locationFields: ['storeId', 'access', 'prefix'],
    secretFields: ['readWriteToken'],
    fields: [
      {
        id: 'access',
        label: 'Store access',
        type: 'choice',
        options: [
          { value: 'public', label: 'Public store' },
          { value: 'private', label: 'Private store' },
        ],
        help: 'Must match how the store was created in Vercel.',
      },
      {
        id: 'storeId',
        label: 'Store ID',
        type: 'text',
        placeholder: 'store_…',
        help: 'Optional. When set, the token must belong to this store.',
      },
      PREFIX_FIELD,
      {
        id: 'readWriteToken',
        label: 'BLOB_READ_WRITE_TOKEN',
        type: 'secret',
        required: true,
        help: 'Vercel › Storage › your Blob store › .env.local.',
      },
    ],
    create(mount, ctx) {
      const config = mount.config ?? {};
      const token = ctx.secrets.readWriteToken?.trim();
      if (!token) {
        throw new BlobStoreError(
          'Vercel Blob read-write token is required',
          400,
        );
      }
      const access = text(config.access) || 'public';
      if (access !== 'public' && access !== 'private') {
        throw new BlobStoreError('access must be public or private', 400);
      }
      const storeId = text(config.storeId).replace(/^store_/, '');
      const tokenStore = storeIdFromToken(token);
      if (storeId && tokenStore && storeId !== tokenStore) {
        throw new BlobStoreError(
          `token belongs to store ${tokenStore}, not ${storeId}`,
          400,
        );
      }
      return createVercelBlobStore({
        token,
        access: access as VercelBlobAccess,
        storeId: storeId || undefined,
        probePrefix: mountPrefix(config),
        fetch: options.fetch,
      });
    },
  };
}

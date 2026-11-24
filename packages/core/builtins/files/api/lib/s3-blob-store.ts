import { S3Client } from 'bun';

import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
import { s3CopyObject, S3RequestError } from './s3-sign';
import type { BlobListOptions, BlobListResult, StorageAdapter } from './types';

/** Minimal surface used by the S3 blob store (Bun.S3Client-compatible). */
export type S3ClientLike = {
  file: (key: string) => {
    write: (data: Blob | ArrayBuffer | Uint8Array | string) => Promise<number>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    exists: () => Promise<boolean>;
    delete: () => Promise<void>;
  };
  list?: (options?: {
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
    delimiter?: string;
    startAfter?: string;
  }) => Promise<{
    contents?: Array<{
      key?: string;
      size?: number;
      lastModified?: string | Date;
    }>;
    commonPrefixes?: Array<{ prefix?: string }>;
    isTruncated?: boolean;
    nextContinuationToken?: string;
  }>;
};

export type S3BlobStoreConfig = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region?: string;
  sessionToken?: string;
  /** Bucket in the host name instead of the path (AWS, Spaces). */
  virtualHostedStyle?: boolean;
  label?: string;
  /** Key prefix used by `test()` for the probe object. */
  probePrefix?: string;
  /**
   * Server-side CopyObject via a signed request (path-style endpoint).
   * Omit to copy by download + upload.
   */
  serverCopy?: { endpoint: string; region: string; fetch?: typeof fetch };
  /** Test injection — skips constructing Bun.S3Client. */
  client?: S3ClientLike;
};

type S3Operation = 'list' | 'read' | 'write' | 'delete' | 'copy';

const PERMISSION_FOR: Record<S3Operation, string> = {
  list: 's3:ListBucket',
  read: 's3:GetObject',
  write: 's3:PutObject',
  delete: 's3:DeleteObject',
  copy: 's3:GetObject + s3:PutObject',
};

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code) return code;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name !== 'Error' ? name : undefined;
}

/** Human message for an S3 failure, naming the missing permission. */
export function describeS3Error(error: unknown, op: S3Operation): string {
  const code = errorCode(error);
  const raw = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'InvalidAccessKeyId':
      return 'access key ID is not recognised by the provider';
    case 'SignatureDoesNotMatch':
      return 'secret access key does not match the access key ID';
    case 'ExpiredToken':
    case 'TokenRefreshRequired':
      return 'session token has expired';
    case 'NoSuchBucket':
      return 'bucket not found (check the bucket name and region)';
    case 'AuthorizationHeaderMalformed':
    case 'PermanentRedirect':
      return 'wrong region for this bucket';
    case 'AccessDenied':
    case 'AllAccessDisabled':
    case 'Forbidden':
      return `access denied for ${op} — grant ${PERMISSION_FOR[op]} on the bucket`;
  }
  if (/\b403\b|access denied|forbidden/i.test(raw)) {
    return `access denied for ${op} — grant ${PERMISSION_FOR[op]} on the bucket`;
  }
  return `${op} failed: ${raw}`;
}

async function guarded<T>(op: S3Operation, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BlobStoreError) throw error;
    throw new BlobStoreError(describeS3Error(error, op), 502);
  }
}

export function createS3BlobStore(config: S3BlobStoreConfig): StorageAdapter {
  const bucket = config.bucket.trim();
  if (!bucket) {
    throw new BlobStoreError('AGENT_OS_EXT_FILES_S3_BUCKET is required', 500);
  }
  if (!config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) {
    throw new BlobStoreError(
      'AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID and AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY are required when S3 bucket is set',
      500,
    );
  }

  const client: S3ClientLike =
    config.client ??
    new S3Client({
      bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      endpoint: config.endpoint,
      region: config.region,
      sessionToken: config.sessionToken,
      virtualHostedStyle: config.virtualHostedStyle,
    });
  const serverCopy = config.serverCopy;
  const credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  };

  return {
    provider: 's3',
    backend: 's3',
    label: config.label ?? `s3://${bucket}`,
    indexMode: 'indexed',
    capabilities: {
      serverSideCopy: Boolean(serverCopy),
      nativeFolders: false,
      nativeTrash: false,
      versions: false,
      maxFileSize: MAX_OBJECT_BYTES,
      exportFormats: [],
      quota: false,
    },
    async put(key, bytes) {
      const objectKey = normalizeBlobKey(key);
      await guarded('write', () => client.file(objectKey).write(bytes));
    },
    async get(key) {
      const objectKey = normalizeBlobKey(key);
      const file = client.file(objectKey);
      return guarded('read', async () => {
        if (!(await file.exists())) return null;
        return new Uint8Array(await file.arrayBuffer());
      });
    },
    async delete(key) {
      const objectKey = normalizeBlobKey(key);
      await guarded('delete', () => client.file(objectKey).delete());
    },
    async list(options: BlobListOptions): Promise<BlobListResult> {
      if (!client.list) {
        throw new BlobStoreError('S3 list not available on client', 500);
      }
      const prefix = options.prefix.replace(/^\/+/, '');
      const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
      const delimiter = options.delimiter === '/' ? '/' : undefined;
      const list = client.list;
      const result = await guarded('list', () =>
        list({
          prefix,
          maxKeys: limit,
          continuationToken: options.cursor || undefined,
          delimiter,
        }),
      );
      const objects = (result.contents ?? [])
        .filter((c) => typeof c.key === 'string' && c.key.length > 0)
        .map((c) => {
          const updated =
            c.lastModified instanceof Date
              ? c.lastModified.toISOString()
              : typeof c.lastModified === 'string'
                ? c.lastModified
                : undefined;
          return {
            key: c.key as string,
            bytes: typeof c.size === 'number' ? c.size : undefined,
            updatedAt: updated,
          };
        });
      const prefixes = (result.commonPrefixes ?? [])
        .map((p) => p.prefix)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      return {
        objects,
        prefixes,
        cursor: result.isTruncated
          ? (result.nextContinuationToken ?? null)
          : null,
      };
    },
    async copy(fromKey, toKey) {
      const from = normalizeBlobKey(fromKey);
      const to = normalizeBlobKey(toKey);
      if (from === to) return;
      if (serverCopy) {
        try {
          await s3CopyObject({
            ...serverCopy,
            bucket,
            credentials,
            fromKey: from,
            toKey: to,
          });
          return;
        } catch (error) {
          const notSupported =
            error instanceof S3RequestError &&
            (error.status === 501 || error.code === 'NotImplemented');
          if (!notSupported) {
            if (error instanceof S3RequestError && error.code === 'NoSuchKey') {
              throw new BlobStoreError('not found', 404);
            }
            throw new BlobStoreError(describeS3Error(error, 'copy'), 502);
          }
        }
      }
      const bytes = await this.get(from);
      if (!bytes) {
        throw new BlobStoreError('not found', 404);
      }
      await this.put(to, bytes);
    },
    /** List + put + delete a probe object so missing permissions surface. */
    async test() {
      const root = (config.probePrefix ?? '').replace(/^\/+/, '');
      const probe = `${root}.agentos-probe-${crypto.randomUUID()}`;
      const list = client.list;
      if (list) {
        await guarded('list', () => list({ prefix: root, maxKeys: 1 }));
      }
      await guarded('write', () => client.file(probe).write('agentos'));
      await guarded('delete', () => client.file(probe).delete());
    },
  };
}

import { S3Client } from 'bun';

import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
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
  /** Test injection — skips constructing Bun.S3Client. */
  client?: S3ClientLike;
};

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
    });

  return {
    provider: 's3',
    backend: 's3',
    label: `s3://${bucket}`,
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
    async put(key, bytes) {
      const objectKey = normalizeBlobKey(key);
      await client.file(objectKey).write(bytes);
    },
    async get(key) {
      const objectKey = normalizeBlobKey(key);
      const file = client.file(objectKey);
      if (!(await file.exists())) return null;
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      const objectKey = normalizeBlobKey(key);
      await client.file(objectKey).delete();
    },
    async list(options: BlobListOptions): Promise<BlobListResult> {
      if (!client.list) {
        throw new BlobStoreError('S3 list not available on client', 500);
      }
      const prefix = options.prefix.replace(/^\/+/, '');
      const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
      const delimiter = options.delimiter === '/' ? '/' : undefined;
      const result = await client.list({
        prefix,
        maxKeys: limit,
        continuationToken: options.cursor || undefined,
        delimiter,
      });
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
      const bytes = await this.get(from);
      if (!bytes) {
        throw new BlobStoreError('not found', 404);
      }
      await this.put(to, bytes);
    },
  };
}

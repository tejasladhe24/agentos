import { S3Client } from 'bun';

import { BlobStoreError } from './blob-store-error';
import { normalizeBlobKey } from './normalize-key';
import type { BlobStore } from './types';

/** Minimal surface used by the S3 blob store (Bun.S3Client-compatible). */
export type S3ClientLike = {
  file: (key: string) => {
    write: (data: Blob | ArrayBuffer | Uint8Array | string) => Promise<number>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    exists: () => Promise<boolean>;
    delete: () => Promise<void>;
  };
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

export function createS3BlobStore(config: S3BlobStoreConfig): BlobStore {
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
    backend: 's3',
    label: `s3://${bucket}`,
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
  };
}

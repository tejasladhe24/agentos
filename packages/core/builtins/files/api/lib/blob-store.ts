import { createFilesystemBlobStore } from './filesystem-blob-store';
import {
  createS3BlobStore,
  type S3BlobStoreConfig,
  type S3ClientLike,
} from './s3-blob-store';
import type { BlobStore, BlobStoreBackend } from './types';

export { BlobStoreError } from './blob-store-error';
export { resolveBlobPath } from './filesystem-blob-store';
export { normalizeBlobKey } from './normalize-key';
export type { BlobStore, BlobStoreBackend, S3BlobStoreConfig, S3ClientLike };

export type CreateBlobStoreOptions = {
  /** Local root when not using S3 (`AGENT_OS_EXT_FILES_PATH`). */
  path?: string;
  /**
   * When `bucket` is set, use S3-compatible storage (R2 / AWS S3 / GCS).
   * Takes precedence over `path`.
   */
  s3?: S3BlobStoreConfig;
};

/**
 * Create a blob store. Filesystem is the default; set `s3.bucket` for
 * durable S3-compatible object storage across restarts.
 */
export async function createBlobStore(
  options: CreateBlobStoreOptions | string = {},
): Promise<BlobStore> {
  // Back-compat: createBlobStore(rootDir) used by older call sites/tests.
  if (typeof options === 'string') {
    return createFilesystemBlobStore(options);
  }

  if (options.s3?.bucket?.trim()) {
    return createS3BlobStore(options.s3);
  }

  return createFilesystemBlobStore(options.path);
}

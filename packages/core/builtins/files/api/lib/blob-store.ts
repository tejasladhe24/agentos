import { createFilesystemBlobStore } from './filesystem-blob-store';
import { MountUnavailableError } from './mounts';
import {
  createS3BlobStore,
  type S3BlobStoreConfig,
  type S3ClientLike,
} from './s3-blob-store';
import type { StorageProviderDefinition } from './storage-providers';
import type {
  BlobStore,
  BlobStoreBackend,
  StorageAdapter,
  StorageCapabilities,
  StorageIndexMode,
} from './types';

export { BlobStoreError } from './blob-store-error';
export { resolveBlobPath } from './filesystem-blob-store';
export { normalizeBlobKey } from './normalize-key';
export type {
  BlobStore,
  BlobStoreBackend,
  S3BlobStoreConfig,
  S3ClientLike,
  StorageAdapter,
  StorageCapabilities,
  StorageIndexMode,
};

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
 * Create the platform mount adapter. Filesystem is the default; set
 * `s3.bucket` for durable S3-compatible object storage across restarts.
 */
export async function createBlobStore(
  options: CreateBlobStoreOptions | string = {},
): Promise<StorageAdapter> {
  // Back-compat: createBlobStore(rootDir) used by older call sites/tests.
  if (typeof options === 'string') {
    return createFilesystemBlobStore(options);
  }

  if (options.s3?.bucket?.trim()) {
    return createS3BlobStore(options.s3);
  }

  return createFilesystemBlobStore(options.path);
}

function envOnly(id: string): StorageProviderDefinition['create'] {
  return () => {
    throw new MountUnavailableError(
      `${id} storage is configured by the deployment env (platform mount only)`,
    );
  };
}

/**
 * Platform-only backends as registry entries (labels / icons for the UI).
 * `s3` is registered separately as an org-addable provider
 * (`createS3MountProvider`); the platform mount never goes through the registry.
 */
export const PLATFORM_STORAGE_PROVIDERS: StorageProviderDefinition[] = [
  {
    id: 'filesystem',
    label: 'Local filesystem',
    icon: 'HardDrives',
    orgAddable: false,
    create: envOnly('filesystem'),
  },
];

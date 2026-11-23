export type BlobStoreBackend = 'filesystem' | 's3';

export type BlobStore = {
  backend: BlobStoreBackend;
  /** Filesystem absolute root, or `s3://bucket`. */
  label: string;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
  /** Remove object if present (idempotent). */
  delete: (key: string) => Promise<void>;
};

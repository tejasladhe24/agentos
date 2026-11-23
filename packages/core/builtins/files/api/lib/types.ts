export type BlobStoreBackend = 'filesystem' | 's3';

export type BlobListObject = {
  key: string;
  bytes?: number;
  updatedAt?: string;
};

export type BlobListResult = {
  objects: BlobListObject[];
  /** Common prefixes (virtual folders), each ending with `/`. */
  prefixes: string[];
  cursor?: string | null;
};

export type BlobListOptions = {
  prefix: string;
  limit?: number;
  cursor?: string;
  /** When `/`, return only one path level + folder prefixes. */
  delimiter?: '/' | '';
};

export type BlobStore = {
  backend: BlobStoreBackend;
  /** Filesystem absolute root, or `s3://bucket`. */
  label: string;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
  /** Remove object if present (idempotent). */
  delete: (key: string) => Promise<void>;
  list: (options: BlobListOptions) => Promise<BlobListResult>;
  /** Server-side copy (overwrite destination). */
  copy: (fromKey: string, toKey: string) => Promise<void>;
};

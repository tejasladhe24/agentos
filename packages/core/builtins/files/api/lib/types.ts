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

/**
 * `indexed` — AgentOS is the only writer; the db-store index is the record
 * (buckets, upload services). `live` — the provider is the record; list live
 * with a short cache (drives).
 */
export type StorageIndexMode = 'indexed' | 'live';

export type StorageCapabilities = {
  /** Copy within the mount without streaming bytes through AgentOS. */
  serverSideCopy: boolean;
  /** Provider has real folders (vs. key-prefix virtual folders). */
  nativeFolders: boolean;
  /** Provider trash replaces the AgentOS `__trash__/` bin for this mount. */
  nativeTrash: boolean;
  versions: boolean;
  /** Max single object size in bytes accepted by the provider. */
  maxFileSize: number;
  /** Export MIME types for provider-native documents (e.g. Google Docs). */
  exportFormats: string[];
  /** Provider reports a storage quota. */
  quota: boolean;
};

export type NativeTrashObject = BlobListObject & {
  trashedAt?: string;
  originalKey?: string;
};

/**
 * Storage backend behind a mount. Keys are absolute within the adapter
 * (the mount scope adds any org / prefix root).
 */
export type StorageAdapter = {
  /** Provider id from the adapter registry (`filesystem`, `s3`, …). */
  provider: string;
  /** @deprecated Platform health label; use `provider`. */
  backend: BlobStoreBackend | string;
  /** Filesystem absolute root, `s3://bucket`, or provider label. */
  label: string;
  indexMode: StorageIndexMode;
  capabilities: StorageCapabilities;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
  /** Remove object if present (idempotent). */
  delete: (key: string) => Promise<void>;
  list: (options: BlobListOptions) => Promise<BlobListResult>;
  /** Copy within the adapter (overwrite destination). */
  copy: (fromKey: string, toKey: string) => Promise<void>;
  /** Optional connectivity probe for Settings › Test. */
  test?: () => Promise<void>;
  /** Native trash (`capabilities.nativeTrash`). Returns the provider trash key. */
  trash?: (key: string) => Promise<{ trashKey: string }>;
  listTrash?: () => Promise<NativeTrashObject[]>;
  restore?: (trashKey: string) => Promise<{ key: string }>;
};

/** @deprecated Use `StorageAdapter`. */
export type BlobStore = StorageAdapter;

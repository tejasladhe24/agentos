export type MountKind = 'org' | 'personal';

export type MountStatus = 'connected' | 'disconnected' | 'error';

export type FilesMount = {
  id: string;
  kind: MountKind;
  /** Set for personal mounts — only this user sees the mount. */
  ownerUserId?: string;
  provider: string;
  name: string;
  /** Default org upload target (`mount=default`). Never a personal mount. */
  isDefault: boolean;
  status: MountStatus;
  /** Non-secret provider settings (bucket, region, folder id, …). */
  config?: Record<string, unknown>;
  /** Last connection error (status `error` / `disconnected`). */
  statusMessage?: string;
  /** Built-in platform mount (not removable, config from env). */
  builtin?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Persisted mount document (platform mount record only carries overrides). */
export type MountRecord = Omit<FilesMount, 'builtin'>;

/** Who is asking — personal mounts are filtered to their owner. */
export type MountViewer = {
  userId?: string;
  /** `header` = trusted peer / background caller with no user. */
  via: 'session' | 'header';
};

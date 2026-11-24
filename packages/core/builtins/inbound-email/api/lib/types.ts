export type InboundAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type NormalizedInboundEmail = {
  /** Provider delivery / message id (idempotency). */
  deliveryId: string;
  /** Envelope / To recipients (lowercased). */
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments: InboundAttachment[];
  /** Raw provider name for audit. */
  provider: string;
};

export type StoredAttachment = {
  filename: string;
  contentType: string;
  /** Storage key within the mount (legacy `orgs/<orgId>/…` for platform). */
  key: string;
  /** Canonical `files://<mountId>/<path>` reference. */
  ref?: string;
  mountId?: string;
  bytes: number;
};

export type InboundMessage = {
  id: string;
  orgId: string;
  deliveryId: string;
  provider: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments: StoredAttachment[];
  receivedAt: string;
  /** ISO timestamp when marked read in the Email manager; omitted/undefined = unread. */
  readAt?: string;
};

export type InboundAddress = {
  id: string;
  address: string;
  orgId: string;
  purpose?: string;
  createdAt: string;
};

export type IngestResult = {
  ok: true;
  duplicate?: boolean;
  message: InboundMessage;
  eventId?: string;
};

export type FilesClient = {
  /** Write a mount-relative path to the org's default (org-kind) mount. */
  putBlob: (
    path: string,
    data: Uint8Array,
    orgId: string,
  ) => Promise<{ key: string; bytes: number; ref?: string; mountId?: string }>;
};

export type EventsClient = {
  publish: (
    topic: string,
    payload: unknown,
  ) => Promise<{ ok: true; event: { id?: string } }>;
};

export type IdempotencyStore = {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, ttl?: number) => Promise<void>;
};

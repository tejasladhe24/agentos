/** Default upstream port — must match `meta.json`. */
export const INBOUND_EMAIL_PORT = 6121;

/** Default db-store peer port (must match db-store meta). */
export const DEFAULT_DB_STORE_PORT = 6111;

/** Platform collection: address → orgId directory. */
export const ADDRESSES_COLLECTION = 'inbound_addresses';

/** Platform collection: BYOK webhook connection id → orgId. */
export const CONNECTIONS_COLLECTION = 'inbound_connections';

/** Org-scoped collection for persisted inbound messages. */
export const MESSAGES_COLLECTION = 'inbound_messages';

/** Durable events topic published after successful ingest. */
export const EMAIL_RECEIVED_TOPIC = 'email.received';

/** Max attachment size accepted per file (10 MiB). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Max attachments per message. */
export const MAX_ATTACHMENTS = 8;

export const ORG_ID_HEADER = 'x-agentos-org-id';

/** List inbox messages (builtin inbound-email). Admin/owner covered by `*`. */
export const PERMISSION_EMAIL_READ = 'email.read';

/** Compose / send via notifications + provision addresses. */
export const PERMISSION_EMAIL_SEND = 'email.send';

/** Max messages returned per inbox page. */
export const MESSAGES_PAGE_MAX = 50;

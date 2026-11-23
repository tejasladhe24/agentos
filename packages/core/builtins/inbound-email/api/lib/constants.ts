/** Default upstream port — must match `meta.json`. */
export const INBOUND_EMAIL_PORT = 6121;

/** Default db-store peer port (must match db-store meta). */
export const DEFAULT_DB_STORE_PORT = 6111;

/** Platform collection: address → orgId directory. */
export const ADDRESSES_COLLECTION = 'inbound_addresses';

/** Org-scoped collection for persisted inbound messages. */
export const MESSAGES_COLLECTION = 'inbound_messages';

/** Durable events topic published after successful ingest. */
export const EMAIL_RECEIVED_TOPIC = 'email.received';

/** Max attachment size accepted per file (10 MiB). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Max attachments per message. */
export const MAX_ATTACHMENTS = 8;

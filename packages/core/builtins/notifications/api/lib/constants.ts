/** Default upstream port — must match `meta.json`. */
export const NOTIFICATIONS_PORT = 6117;

export const NOTIFICATIONS_MAX = 100;

/** Default db-store peer port (must match db-store meta). */
export const DEFAULT_DB_STORE_PORT = 6111;

export const NOTIFICATIONS_COLLECTION = 'notifications';

export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Read email deliveries / inbox (shared with inbound-email). */
export const PERMISSION_EMAIL_READ = 'email.read';

/** Send email/SMS via notify. */
export const PERMISSION_EMAIL_SEND = 'email.send';

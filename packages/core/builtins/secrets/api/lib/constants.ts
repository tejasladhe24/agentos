/** Default upstream port — must match `meta.json`. */
export const SECRETS_PORT = 6118;

/** Org-scoped db-store collection for encrypted vault rows. */
export const SECRETS_COLLECTION = 'secrets_vault';

/** Trusted peer / FDE header carrying the active org id (matches db-store). */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Trusted peer header naming the user a service acts for (user-owned secrets). */
export const USER_ID_HEADER = 'x-agentos-user-id';

/** Storage-key prefix for user-owned rows; `~` never starts a valid public key. */
export const USER_OWNED_KEY_PREFIX = '~u/';

/** Event topic published after a removed member's user-owned secrets are purged. */
export const SECRETS_USER_PURGED_TOPIC = 'secrets.user_purged';

/** Permission to read vault secrets (admin/owner covered by `*`). */
export const PERMISSION_SECRETS_READ = 'secrets.read';

/** Permission to put/delete vault secrets (admin/owner covered by `*`). */
export const PERMISSION_SECRETS_WRITE = 'secrets.write';

/** AES-GCM algorithm label stored with ciphertext. */
export const SECRETS_ALG = 'AES-256-GCM' as const;

/**
 * Vault key names: start with a letter; letters, digits, `.` `_` `-` `/` after.
 * Max length 128.
 */
export const SECRET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._/-]{0,127}$/;

/**
 * Vault prefix owned by the integrations kit (ticket 103). Session callers
 * cannot reveal, write, or delete these keys — only trusted peers can.
 */
export const MANAGED_KEY_PREFIX = 'integrations/';

/** Max rows returned by `GET /secrets` (org-scoped). */
export const SECRETS_LIST_LIMIT = 500;

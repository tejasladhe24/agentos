/** Default upstream port — must match `meta.json`. */
export const FILES_PORT = 6116;

/** Trusted peer / FDE header carrying the active org id (matches db-store / secrets). */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Trusted peer header naming the user a service acts for (AI runs only). */
export const USER_ID_HEADER = 'x-agentos-user-id';

/** Org-scoped db-store collection for blob metadata (content-type, size, mtime). */
export const FILES_OBJECTS_COLLECTION = 'files_objects';

/** Org-scoped db-store collection for Files settings (bin retention). */
export const FILES_SETTINGS_COLLECTION = 'files_org_settings';

/** Mounts are integration instances (ticket 103 kit) — `files.mount:<mountId>`. */
export const FILES_MOUNT_INTEGRATION = 'files.mount';

/** Permission to add / rename / set default / remove org mounts. */
export const PERMISSION_FILES_MOUNTS_MANAGE = 'files.mounts.manage';

/** TTL for live-mode (provider is the record) list caching. */
export const LIVE_LIST_CACHE_MS = 15_000;

/** Permission to list/get blobs (admin/owner covered by `*`). */
export const PERMISSION_FILES_READ = 'files.read';

/** Permission to put/delete/move blobs (admin/owner covered by `*`). */
export const PERMISSION_FILES_WRITE = 'files.write';

/** Max single object size (aligned with AI attachment limit). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

/** Platform-wide Google OAuth app for personal Drive mounts (env, not vault). */
export const GOOGLE_CLIENT_ID_ENV = 'AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID';
export const GOOGLE_CLIENT_SECRET_ENV =
  'AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET';

/** Default page size for list / browse. */
export const LIST_PAGE_SIZE = 100;

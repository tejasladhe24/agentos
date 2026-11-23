/** Default upstream port — must match `meta.json`. */
export const FILES_PORT = 6116;

/** Trusted peer / FDE header carrying the active org id (matches db-store / secrets). */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Org-scoped db-store collection for blob metadata (content-type, size, mtime). */
export const FILES_OBJECTS_COLLECTION = 'files_objects';

/** Permission to list/get blobs (admin/owner covered by `*`). */
export const PERMISSION_FILES_READ = 'files.read';

/** Permission to put/delete/move blobs (admin/owner covered by `*`). */
export const PERMISSION_FILES_WRITE = 'files.write';

/** Max single object size (aligned with AI attachment limit). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

/** Default page size for list / browse. */
export const LIST_PAGE_SIZE = 100;

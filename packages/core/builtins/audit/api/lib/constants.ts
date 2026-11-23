/** Default upstream port — must match `meta.json`. */
export const AUDIT_PORT = 6119;

/** Default db-store peer port (must match db-store meta). */
export const DEFAULT_DB_STORE_PORT = 6111;

export const AUDIT_COLLECTION = 'audit_entries';

/** Trusted peer / FDE header carrying the active org id (matches secrets / db-store). */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Session callers need this to list Activity entries. */
export const PERMISSION_AUDIT_READ = 'audit.read';

/** Default page size for GET /entries. */
export const DEFAULT_LIST_LIMIT = 50;

/** Max page size for GET /entries (UI initial load stays ≤100). */
export const MAX_LIST_LIMIT = 100;

/** Max rows the Activity UI may export for one filtered download. */
export const MAX_EXPORT_ROWS = 1000;

/** Batch size when scanning db-store for in-process q / action-prefix filters. */
export const IN_PROCESS_SCAN_BATCH = 100;

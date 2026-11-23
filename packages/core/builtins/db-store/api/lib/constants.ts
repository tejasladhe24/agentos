/** Default upstream port — must match `meta.json`. */
export const DB_STORE_PORT = 6111;

/** Sentinel org for platform control-plane collections (no tenant session). */
export const PLATFORM_ORG_ID = '__platform__';

/** Backfill value for rows that existed before tenancy. */
export const UNSCOPED_ORG_ID = '__unscoped__';

/** Trusted peer / FDE header carrying the active org id. */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/**
 * Collections that skip session org resolution and always use {@link PLATFORM_ORG_ID}.
 * Gateway enable-state + builtin peer stores (hitl / audit / notifications).
 */
export const PLATFORM_COLLECTIONS = new Set([
  'agentos_gateway',
  'hitl_approvals',
  'audit_entries',
  'notifications',
  'events_outbox',
  'events_jobs',
]);

export function isPlatformCollection(name: string): boolean {
  return PLATFORM_COLLECTIONS.has(name);
}

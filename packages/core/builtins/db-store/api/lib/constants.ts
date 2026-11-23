/** Default upstream port — must match `meta.json`. */
export const DB_STORE_PORT = 6111;

/** Sentinel org for platform control-plane collections (no tenant session). */
export const PLATFORM_ORG_ID = '__platform__';

/** Backfill value for rows that existed before tenancy. */
export const UNSCOPED_ORG_ID = '__unscoped__';

/** Trusted peer / FDE header carrying the active org id. */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Max docs per `insert-bulk` request (all-or-nothing). */
export const MAX_BULK_INSERT = 100;

/**
 * Platform collection storing per-org retention policies (ticket 84).
 * Doc id = `${orgId}::${collectionName}`.
 */
export const RETENTION_POLICIES_COLLECTION = 'agentos_retention_policies';

/**
 * Platform collection storing org-level retention / legal hold (ticket 87).
 * Doc id = `orgId`.
 */
export const ORG_RETENTION_COLLECTION = 'agentos_org_retention';

/** Default background prune interval (ms). Override with env. */
export const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

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
  RETENTION_POLICIES_COLLECTION,
  ORG_RETENTION_COLLECTION,
]);

export function isPlatformCollection(name: string): boolean {
  return PLATFORM_COLLECTIONS.has(name);
}

/** Policy document id for an org + logical collection. */
export function retentionPolicyDocId(
  orgId: string,
  collection: string,
): string {
  return `${orgId}::${collection}`;
}

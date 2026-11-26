/** Default upstream port — must match `meta.json`. */
export const EVENTS_PORT = 6115;

/** Default db-store peer port (must match db-store meta). */
export const DEFAULT_DB_STORE_PORT = 6111;

/** Durable publish outbox (platform collection). */
export const EVENTS_OUTBOX_COLLECTION = 'events_outbox';

/** Scheduled jobs (platform collection). */
export const EVENTS_JOBS_COLLECTION = 'events_jobs';

/** Default claim lease duration. */
export const DEFAULT_LEASE_MS = 30_000;

/** Attempts before a message is marked dead (poison). */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Scheduler / lease recovery tick interval. */
export const DEFAULT_TICK_MS = 1_000;

/**
 * Scope for events with no tenant (server-originated, e.g. `hitl.resolved`).
 * Session subscribers never receive these; only service subscribers do.
 */
export const PLATFORM_ORG_ID = '__platform__';

/** Roles allowed to manage scheduled jobs from a browser session. */
export const JOB_ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'owner']);

/** Longest accepted topic name. */
export const MAX_TOPIC_LENGTH = 128;

/**
 * Topics only server-side builtins may publish. A browser session (extension
 * UI) publishing these would let an extension forge platform signals.
 */
export const SERVER_ONLY_TOPICS: ReadonlySet<string> = new Set([
  'hitl.resolved',
  'hitl.requested',
  'email.received',
  'secrets.user_purged',
  'integration.changed',
]);

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

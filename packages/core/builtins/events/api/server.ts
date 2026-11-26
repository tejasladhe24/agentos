import { keys } from './env';
import {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TICK_MS,
  EVENTS_JOBS_COLLECTION,
  EVENTS_OUTBOX_COLLECTION,
  EVENTS_PORT,
} from './lib/constants';
import { createEventsAuthenticator, resolveAuthApiBase } from './lib/auth';
import { createDbStoreClient } from './lib/db-store-client';
import { createEventBus } from './lib/event-bus';
import { handleEventsRequest } from './lib/handle-request';
import { createJobsStore } from './lib/jobs-store';
import { createOutboxStore } from './lib/outbox-store';
import { runSchedulerTick } from './lib/scheduler';

const env = keys();

const port = env.AGENT_OS_EXT_EVENTS_PORT ?? EVENTS_PORT;
const dbHost = env.AGENT_OS_EXT_EVENTS_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_EVENTS_DB_STORE_PORT ?? 6111;
const leaseMs = env.AGENT_OS_EXT_EVENTS_LEASE_MS ?? DEFAULT_LEASE_MS;
const maxAttempts =
  env.AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS;
const tickMs = env.AGENT_OS_EXT_EVENTS_TICK_MS ?? DEFAULT_TICK_MS;

const db = createDbStoreClient(
  `http://${dbHost}:${dbPort}`,
  EVENTS_OUTBOX_COLLECTION,
  EVENTS_JOBS_COLLECTION,
);
const clock = () => new Date();
const bus = createEventBus();
const outbox = createOutboxStore(db, clock);
const jobs = createJobsStore(db, clock);
const workerId = `events-${crypto.randomUUID().slice(0, 8)}`;

// Browser sessions resolve through builtin auth; in-stack callers (workers,
// hitl, inbound-email, Python services) present the shared service token.
const serviceToken = Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN;
const authenticate = createEventsAuthenticator({
  serviceToken,
  authApiBase: resolveAuthApiBase(),
});
if (!serviceToken?.trim()) {
  console.warn(
    '[agentos events] AGENT_OS_EVENTS_SERVICE_TOKEN is not set: service callers (queue, scheduled http jobs, server-side publish) are rejected; only browser sessions are accepted. `agentos dev` / `agentos start` set it automatically.',
  );
}

const deps = {
  bus,
  outbox,
  jobs,
  workerId,
  leaseMs,
  maxAttempts,
  authenticate,
};

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleEventsRequest(deps, request);
  },
});

const tick = setInterval(() => {
  void runSchedulerTick({ jobs, outbox, bus }).catch((error) => {
    console.error('[agentos events] scheduler tick failed', error);
  });
}, tickMs);
tick.unref?.();

console.log(
  `[agentos events] listening on http://127.0.0.1:${server.port} (proxy /api/ext/events/*) db-store=http://${dbHost}:${dbPort} worker=${workerId}`,
);

/**
 * @agentos/core/api/events — HTTP client for builtin `events` (tickets 23 / 74).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/**
 * Shared secret between in-stack callers and builtin `events`. `agentos dev` /
 * `agentos start` generate one per stack; browsers never receive it.
 */
export const EVENTS_SERVICE_TOKEN_ENV = 'AGENT_OS_EVENTS_SERVICE_TOKEN';

/** Peer header naming the org a service call acts for (service callers only). */
export const EVENTS_ORG_HEADER = 'x-agentos-org-id';

/**
 * Auth headers for service-to-service calls to builtin `events`.
 * Pass `orgId` to scope the call to one tenant; omit for platform scope.
 */
export function eventsServiceHeaders(
  env: EnvMap = Bun.env,
  orgId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = env[EVENTS_SERVICE_TOKEN_ENV]?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers[EVENTS_ORG_HEADER] = orgId;
  return headers;
}

/** Resolve builtin events API base (`…/api/ext/events` or test override). */
export function resolveEventsApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('events', 'AGENT_OS_EVENTS_API_BASE', env);
}

export type EventMessage = {
  id?: string;
  topic: string;
  payload: unknown;
  at: string;
};

export type PublishResult = {
  ok: true;
  event: EventMessage;
};

export type OutboxMessage = {
  id: string;
  topic: string;
  payload: unknown;
  status: 'pending' | 'leased' | 'acked' | 'dead';
  attempts: number;
  availableAt: string;
  createdAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  lastError?: string;
  ackedAt?: string;
};

export type ScheduleJobInput = {
  kind: 'at' | 'cron';
  action: 'publish' | 'http';
  runAt?: string;
  cron?: string;
  topic?: string;
  payload?: unknown;
  url?: string;
  body?: unknown;
  enabled?: boolean;
};

export type ScheduledJob = ScheduleJobInput & {
  id: string;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
  lastRunAt?: string;
  lastError?: string;
};

export type PublishOptions = {
  /** Tenant the event belongs to; omit for a platform-scoped event. */
  orgId?: string;
};

export async function publish(
  topic: string,
  payload: unknown = null,
  env?: EnvMap,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<PublishResult>(
    `${base}/publish`,
    {
      method: 'POST',
      body: { topic, payload },
      headers: eventsServiceHeaders(resolved, options.orgId),
    },
    'events publish',
  );
}

/**
 * Build SSE subscribe URL (long-lived connection left to the caller).
 * Pass one topic string or multiple via `topics`. Send
 * {@link eventsServiceHeaders} with the request — `subscribe` requires auth.
 */
export function subscribeUrl(topics: string | string[], env?: EnvMap): string {
  const base = resolveEventsApiBase(env ?? Bun.env);
  const list = Array.isArray(topics) ? topics : [topics];
  const params = new URLSearchParams();
  if (list.length === 1 && list[0]) {
    params.set('topic', list[0]);
  } else {
    for (const t of list) {
      params.append('topics', t);
    }
  }
  return `${base}/subscribe?${params.toString()}`;
}

/** Claim up to `limit` due outbox messages (lease / visibility timeout). */
export async function claim(
  limit = 1,
  env?: EnvMap,
): Promise<{ messages: OutboxMessage[] }> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<{ messages: OutboxMessage[] }>(
    `${base}/queue/claim`,
    {
      method: 'POST',
      body: { limit },
      headers: eventsServiceHeaders(resolved),
    },
    'events claim',
  );
}

export async function ack(
  id: string,
  env?: EnvMap,
): Promise<{ message: OutboxMessage }> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<{ message: OutboxMessage }>(
    `${base}/queue/ack`,
    {
      method: 'POST',
      body: { id },
      headers: eventsServiceHeaders(resolved),
    },
    'events ack',
  );
}

export async function nack(
  id: string,
  error?: string,
  env?: EnvMap,
): Promise<{ message: OutboxMessage }> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<{ message: OutboxMessage }>(
    `${base}/queue/nack`,
    {
      method: 'POST',
      body: { id, ...(error ? { error } : {}) },
      headers: eventsServiceHeaders(resolved),
    },
    'events nack',
  );
}

export async function scheduleJob(
  input: ScheduleJobInput,
  env?: EnvMap,
): Promise<ScheduledJob> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<ScheduledJob>(
    `${base}/jobs`,
    {
      method: 'POST',
      body: input,
      headers: eventsServiceHeaders(resolved),
    },
    'events schedule',
  );
}

export async function listJobs(
  env?: EnvMap,
): Promise<{ jobs: ScheduledJob[] }> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<{ jobs: ScheduledJob[] }>(
    `${base}/jobs`,
    { method: 'GET', headers: eventsServiceHeaders(resolved) },
    'events list jobs',
  );
}

export async function deleteJob(
  id: string,
  env?: EnvMap,
): Promise<{ ok: true }> {
  const resolved = env ?? Bun.env;
  const base = resolveEventsApiBase(resolved);
  return jsonFetch<{ ok: true }>(
    `${base}/jobs/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: eventsServiceHeaders(resolved) },
    'events delete job',
  );
}

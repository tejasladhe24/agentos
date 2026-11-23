/**
 * @agentos/core/api/events — HTTP client for builtin `events` (tickets 23 / 74).
 */

import {
  getJson,
  jsonFetch,
  postJson,
  resolveExtApiBase,
  type EnvMap,
} from './http';

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

export async function publish(
  topic: string,
  payload: unknown = null,
  env?: EnvMap,
): Promise<PublishResult> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return postJson<PublishResult>(
    `${base}/publish`,
    { topic, payload },
    'events publish',
  );
}

/**
 * Build SSE subscribe URL (long-lived connection left to the caller).
 * Pass one topic string or multiple via `topics`.
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
  const base = resolveEventsApiBase(env ?? Bun.env);
  return postJson<{ messages: OutboxMessage[] }>(
    `${base}/queue/claim`,
    { limit },
    'events claim',
  );
}

export async function ack(
  id: string,
  env?: EnvMap,
): Promise<{ message: OutboxMessage }> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return postJson<{ message: OutboxMessage }>(
    `${base}/queue/ack`,
    { id },
    'events ack',
  );
}

export async function nack(
  id: string,
  error?: string,
  env?: EnvMap,
): Promise<{ message: OutboxMessage }> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return postJson<{ message: OutboxMessage }>(
    `${base}/queue/nack`,
    { id, ...(error ? { error } : {}) },
    'events nack',
  );
}

export async function scheduleJob(
  input: ScheduleJobInput,
  env?: EnvMap,
): Promise<ScheduledJob> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return postJson<ScheduledJob>(`${base}/jobs`, input, 'events schedule');
}

export async function listJobs(
  env?: EnvMap,
): Promise<{ jobs: ScheduledJob[] }> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return getJson<{ jobs: ScheduledJob[] }>(`${base}/jobs`, 'events list jobs');
}

export async function deleteJob(
  id: string,
  env?: EnvMap,
): Promise<{ ok: true }> {
  const base = resolveEventsApiBase(env ?? Bun.env);
  return jsonFetch<{ ok: true }>(
    `${base}/jobs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    'events delete job',
  );
}

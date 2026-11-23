import { json, parseJobId, readJsonBody, unavailable } from './http';
import type { CreateJobInput, JobsStore } from './jobs-store';
import type { EventBus } from './event-bus';
import type { OutboxStore } from './outbox-store';
import { runSchedulerTick } from './scheduler';

/** Mirrors `EventsHandlerDeps` without importing handle-request (avoid cycles). */
export type EventsRouteDeps = {
  bus: EventBus;
  outbox: OutboxStore;
  jobs: JobsStore;
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  fetchImpl?: typeof fetch;
};

export type EventsRouteHandler = (
  deps: EventsRouteDeps,
  request: Request,
  url: URL,
  path: string,
) => Promise<Response>;

export async function handleHealth(
  deps: EventsRouteDeps,
): Promise<Response> {
  return json({
    ok: true,
    backend: 'db-store',
    subscribers: deps.bus.subscriberCount,
  });
}

export async function handlePublish(
  deps: EventsRouteDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  if (!topic) {
    return json({ error: 'topic required' }, { status: 400 });
  }
  try {
    const record = await deps.outbox.publish(topic, body?.payload ?? null);
    const msg = deps.bus.publish(topic, record.payload);
    return json({
      ok: true,
      event: { ...msg, id: record.id },
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleSubscribe(
  deps: EventsRouteDeps,
  _request: Request,
  url: URL,
): Promise<Response> {
  const topicParam = url.searchParams.get('topic');
  const topicsParam = url.searchParams.getAll('topics');
  const topics =
    topicsParam.length > 0 ? topicsParam : topicParam ? [topicParam] : null;
  const { stream } = deps.bus.subscribe(topics);
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

export async function handleQueueClaim(
  deps: EventsRouteDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const limitRaw = body?.limit;
  const limit =
    typeof limitRaw === 'number' && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 100)
      : 1;
  try {
    const messages = await deps.outbox.claim({
      limit,
      workerId: deps.workerId,
      leaseMs: deps.leaseMs,
    });
    return json({ messages });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleQueueAck(
  deps: EventsRouteDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return json({ error: 'id required' }, { status: 400 });
  try {
    const message = await deps.outbox.ack(id);
    if (!message) return json({ error: 'not found' }, { status: 404 });
    return json({ message });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleQueueNack(
  deps: EventsRouteDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return json({ error: 'id required' }, { status: 400 });
  const errorMsg = typeof body?.error === 'string' ? body.error : undefined;
  try {
    const message = await deps.outbox.nack(id, {
      maxAttempts: deps.maxAttempts,
      error: errorMsg,
    });
    if (!message) return json({ error: 'not found' }, { status: 404 });
    return json({ message });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleListJobs(
  deps: EventsRouteDeps,
): Promise<Response> {
  try {
    return json({ jobs: await deps.jobs.list() });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleCreateJob(
  deps: EventsRouteDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const kind = body?.kind;
  const action = body?.action;
  if (kind !== 'at' && kind !== 'cron') {
    return json({ error: 'kind must be "at" or "cron"' }, { status: 400 });
  }
  if (action !== 'publish' && action !== 'http') {
    return json(
      { error: 'action must be "publish" or "http"' },
      { status: 400 },
    );
  }
  const input: CreateJobInput = {
    kind,
    action,
    ...(typeof body?.runAt === 'string' ? { runAt: body.runAt } : {}),
    ...(typeof body?.cron === 'string' ? { cron: body.cron } : {}),
    ...(typeof body?.topic === 'string' ? { topic: body.topic } : {}),
    ...(body && 'payload' in body ? { payload: body.payload } : {}),
    ...(typeof body?.url === 'string' ? { url: body.url } : {}),
    ...(body && 'body' in body ? { body: body.body } : {}),
    ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
  };
  try {
    const job = await deps.jobs.create(input);
    return json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/required|invalid|never matches/i.test(message)) {
      return json({ error: message }, { status: 400 });
    }
    return unavailable(error);
  }
}

export async function handleDeleteJob(
  deps: EventsRouteDeps,
  _request: Request,
  _url: URL,
  path: string,
): Promise<Response> {
  const jobId = parseJobId(path);
  if (!jobId) {
    return json({ error: 'not found' }, { status: 404 });
  }
  try {
    const ok = await deps.jobs.remove(jobId);
    if (!ok) return json({ error: 'not found' }, { status: 404 });
    return json({ ok: true });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleJobsTick(
  deps: EventsRouteDeps,
): Promise<Response> {
  try {
    const ran = await runSchedulerTick({
      jobs: deps.jobs,
      outbox: deps.outbox,
      bus: deps.bus,
      fetchImpl: deps.fetchImpl,
    });
    return json({ ok: true, ran });
  } catch (error) {
    return unavailable(error);
  }
}

export const EVENTS_EXACT_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
  handle: EventsRouteHandler;
}> = [
  { method: 'GET', path: '/health', handle: (d) => handleHealth(d) },
  {
    method: 'POST',
    path: '/publish',
    handle: (d, r) => handlePublish(d, r),
  },
  {
    method: 'GET',
    path: '/subscribe',
    handle: (d, r, u) => handleSubscribe(d, r, u),
  },
  {
    method: 'POST',
    path: '/queue/claim',
    handle: (d, r) => handleQueueClaim(d, r),
  },
  {
    method: 'POST',
    path: '/queue/ack',
    handle: (d, r) => handleQueueAck(d, r),
  },
  {
    method: 'POST',
    path: '/queue/nack',
    handle: (d, r) => handleQueueNack(d, r),
  },
  { method: 'GET', path: '/jobs', handle: (d) => handleListJobs(d) },
  { method: 'POST', path: '/jobs', handle: (d, r) => handleCreateJob(d, r) },
  {
    method: 'POST',
    path: '/jobs/tick',
    handle: (d) => handleJobsTick(d),
  },
];

import { readScope, writeOrgId, type EventsPrincipal } from './auth';
import { json, parseJobId, readJsonBody, unavailable } from './http';
import type { CreateJobInput, JobsStore } from './jobs-store';
import type { EventBus } from './event-bus';
import type { OutboxStore } from './outbox-store';
import { isServerOnlyTopic, jobUrlError, topicError } from './policy';
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

/**
 * Who may call a route.
 * - `public`: no credential (health only).
 * - `any`: a browser session with an active org, or a service caller.
 * - `service`: only a holder of the service token (workers, maintenance).
 * - `admin`: a service caller, or a session with an admin role.
 */
export type RouteAccess = 'public' | 'any' | 'service' | 'admin';

export type RouteContext = {
  request: Request;
  url: URL;
  path: string;
  /** Resolved caller; `null` only on `public` routes. */
  principal: EventsPrincipal | null;
};

export type EventsRouteHandler = (
  deps: EventsRouteDeps,
  ctx: RouteContext,
) => Promise<Response>;

function requirePrincipal(ctx: RouteContext): EventsPrincipal {
  if (!ctx.principal) {
    // Router guarantees a principal on non-public routes; fail closed anyway.
    throw new Error('events route reached without a principal');
  }
  return ctx.principal;
}

/** Reject a topic that is malformed, or server-only for a browser session. */
function topicRejection(
  topic: string,
  principal: EventsPrincipal,
): Response | null {
  const invalid = topicError(topic);
  if (invalid) return json({ error: invalid }, { status: 400 });
  if (principal.kind === 'session' && isServerOnlyTopic(topic)) {
    return json(
      { error: `topic "${topic}" is reserved for server-side publishers` },
      { status: 403 },
    );
  }
  return null;
}

export async function handleHealth(deps: EventsRouteDeps): Promise<Response> {
  return json({
    ok: true,
    backend: 'db-store',
    subscribers: deps.bus.subscriberCount,
  });
}

export async function handlePublish(
  deps: EventsRouteDeps,
  ctx: RouteContext,
): Promise<Response> {
  const principal = requirePrincipal(ctx);
  const body = await readJsonBody(ctx.request);
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  const rejection = topicRejection(topic, principal);
  if (rejection) return rejection;

  const orgId = writeOrgId(principal);
  try {
    const record = await deps.outbox.publish(
      topic,
      body?.payload ?? null,
      orgId,
    );
    const msg = deps.bus.publish(topic, record.payload, orgId);
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
  ctx: RouteContext,
): Promise<Response> {
  const principal = requirePrincipal(ctx);
  const topicParam = ctx.url.searchParams.get('topic');
  const topicsParam = ctx.url.searchParams.getAll('topics');
  const topics =
    topicsParam.length > 0 ? topicsParam : topicParam ? [topicParam] : null;
  // Sessions only ever see their own org; service callers see every org
  // unless they name one with the org header.
  const { stream } = deps.bus.subscribe(topics, readScope(principal));
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
  ctx: RouteContext,
): Promise<Response> {
  const body = await readJsonBody(ctx.request);
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
  ctx: RouteContext,
): Promise<Response> {
  const body = await readJsonBody(ctx.request);
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
  ctx: RouteContext,
): Promise<Response> {
  const body = await readJsonBody(ctx.request);
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
  ctx: RouteContext,
): Promise<Response> {
  const principal = requirePrincipal(ctx);
  try {
    return json({ jobs: await deps.jobs.list(readScope(principal)) });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleCreateJob(
  deps: EventsRouteDeps,
  ctx: RouteContext,
): Promise<Response> {
  const principal = requirePrincipal(ctx);
  const body = await readJsonBody(ctx.request);
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

  if (action === 'http') {
    // Outbound HTTP from the scheduler is a server-side capability; a browser
    // session must not be able to make the platform fetch arbitrary URLs.
    if (principal.kind !== 'service') {
      return json(
        { error: 'http jobs require a service credential' },
        { status: 403 },
      );
    }
    if (typeof body?.url === 'string' && body.url.trim()) {
      const blocked = jobUrlError(body.url.trim());
      if (blocked) return json({ error: blocked }, { status: 400 });
    }
  } else if (typeof body?.topic === 'string' && body.topic.trim()) {
    const rejection = topicRejection(body.topic.trim(), principal);
    if (rejection) return rejection;
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
    const job = await deps.jobs.create(input, writeOrgId(principal));
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
  ctx: RouteContext,
): Promise<Response> {
  const principal = requirePrincipal(ctx);
  const jobId = parseJobId(ctx.path);
  if (!jobId) {
    return json({ error: 'not found' }, { status: 404 });
  }
  try {
    // Out-of-scope jobs read as missing so org membership is not leaked.
    const ok = await deps.jobs.remove(jobId, readScope(principal));
    if (!ok) return json({ error: 'not found' }, { status: 404 });
    return json({ ok: true });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleJobsTick(deps: EventsRouteDeps): Promise<Response> {
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
  access: RouteAccess;
  handle: EventsRouteHandler;
}> = [
  {
    method: 'GET',
    path: '/health',
    access: 'public',
    handle: (d) => handleHealth(d),
  },
  {
    method: 'POST',
    path: '/publish',
    access: 'any',
    handle: handlePublish,
  },
  {
    method: 'GET',
    path: '/subscribe',
    access: 'any',
    handle: handleSubscribe,
  },
  {
    method: 'POST',
    path: '/queue/claim',
    access: 'service',
    handle: handleQueueClaim,
  },
  {
    method: 'POST',
    path: '/queue/ack',
    access: 'service',
    handle: handleQueueAck,
  },
  {
    method: 'POST',
    path: '/queue/nack',
    access: 'service',
    handle: handleQueueNack,
  },
  { method: 'GET', path: '/jobs', access: 'admin', handle: handleListJobs },
  { method: 'POST', path: '/jobs', access: 'admin', handle: handleCreateJob },
  {
    method: 'POST',
    path: '/jobs/tick',
    access: 'service',
    handle: (d) => handleJobsTick(d),
  },
];

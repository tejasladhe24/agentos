import type { EventBus } from './event-bus';
import type { CreateJobInput, JobsStore } from './jobs-store';
import type { OutboxStore } from './outbox-store';
import { runSchedulerTick } from './scheduler';

export type EventsHandlerDeps = {
  bus: EventBus;
  outbox: OutboxStore;
  jobs: JobsStore;
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  /** Optional fetch for scheduler HTTP jobs (tests). */
  fetchImpl?: typeof fetch;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

function parseJobId(path: string): string | null {
  const match = path.match(/^\/jobs\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Thin Bun request router for `/api/ext/events/*` upstream paths.
 */
export async function handleEventsRequest(
  deps: EventsHandlerDeps,
  request: Request,
): Promise<Response> {
  const { bus, outbox, jobs } = deps;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      backend: 'db-store',
      subscribers: bus.subscriberCount,
    });
  }

  if (method === 'POST' && path === '/publish') {
    const body = await readJsonBody(request);
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    if (!topic) {
      return json({ error: 'topic required' }, { status: 400 });
    }
    try {
      const record = await outbox.publish(topic, body?.payload ?? null);
      const msg = bus.publish(topic, record.payload);
      return json({
        ok: true,
        event: { ...msg, id: record.id },
      });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'GET' && path === '/subscribe') {
    const topicParam = url.searchParams.get('topic');
    const topicsParam = url.searchParams.getAll('topics');
    const topics =
      topicsParam.length > 0 ? topicsParam : topicParam ? [topicParam] : null;
    const { stream } = bus.subscribe(topics);
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  if (method === 'POST' && path === '/queue/claim') {
    const body = await readJsonBody(request);
    const limitRaw = body?.limit;
    const limit =
      typeof limitRaw === 'number' && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 100)
        : 1;
    try {
      const messages = await outbox.claim({
        limit,
        workerId: deps.workerId,
        leaseMs: deps.leaseMs,
      });
      return json({ messages });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/queue/ack') {
    const body = await readJsonBody(request);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'id required' }, { status: 400 });
    try {
      const message = await outbox.ack(id);
      if (!message) return json({ error: 'not found' }, { status: 404 });
      return json({ message });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/queue/nack') {
    const body = await readJsonBody(request);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'id required' }, { status: 400 });
    const errorMsg = typeof body?.error === 'string' ? body.error : undefined;
    try {
      const message = await outbox.nack(id, {
        maxAttempts: deps.maxAttempts,
        error: errorMsg,
      });
      if (!message) return json({ error: 'not found' }, { status: 404 });
      return json({ message });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'GET' && path === '/jobs') {
    try {
      return json({ jobs: await jobs.list() });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/jobs') {
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
      const job = await jobs.create(input);
      return json(job, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/required|invalid|never matches/i.test(message)) {
        return json({ error: message }, { status: 400 });
      }
      return unavailable(error);
    }
  }

  const jobId = parseJobId(path);
  if (method === 'DELETE' && jobId) {
    try {
      const ok = await jobs.remove(jobId);
      if (!ok) return json({ error: 'not found' }, { status: 404 });
      return json({ ok: true });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/jobs/tick') {
    try {
      const ran = await runSchedulerTick({
        jobs,
        outbox,
        bus,
        fetchImpl: deps.fetchImpl,
      });
      return json({ ok: true, ran });
    } catch (error) {
      return unavailable(error);
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
